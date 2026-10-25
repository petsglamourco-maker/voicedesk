import { createHash } from "node:crypto";
import type { PushMessage, PushProvider, PushSubscriptionData } from "@voicedesk/adapters";
import { pushSubscriptions, type Database } from "@voicedesk/db";
import { eq, inArray } from "drizzle-orm";
import type { SecretBox } from "./secret-box";

/**
 * Push notifications to people's phones (ADR 0024). Subscriptions belong to a person and one
 * sign-in session, and are stored encrypted. Messages carry no customer details.
 */

/** Ciphertext is bound to its owner, so a row copied to another person won't decrypt. */
export const pushContext = (userId: string) => `push_subscriptions:${userId}`;

export const endpointHash = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex");

export async function savePushSubscription(
  db: Database,
  box: SecretBox,
  params: {
    userId: string;
    sessionId: string;
    subscription: PushSubscriptionData;
    deviceLabel: string | null;
  },
): Promise<void> {
  const values = {
    userId: params.userId,
    sessionId: params.sessionId,
    subscription: box.encrypt(
      JSON.stringify({
        endpoint: params.subscription.endpoint,
        keys: params.subscription.keys,
      }),
      pushContext(params.userId),
    ),
    deviceLabel: params.deviceLabel,
  };
  // The same browser subscribing again (or after someone else signed in on it) replaces
  // the old row, so a shared device only notifies whoever is signed in now.
  await db
    .insert(pushSubscriptions)
    .values({ ...values, endpointHash: endpointHash(params.subscription.endpoint) })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpointHash,
      set: { ...values, createdAt: new Date(), lastUsedAt: null },
    });
}

/** Sends to every device of these people; removes subscriptions the push service dropped. */
export async function sendPush(
  deps: { db: Database; box: SecretBox; push: PushProvider | null },
  userIds: string[],
  message: PushMessage,
): Promise<{ sent: number; removed: number }> {
  if (!deps.push || userIds.length === 0) return { sent: 0, removed: 0 };
  const rows = await deps.db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, [...new Set(userIds)]));
  let sent = 0;
  const gone: string[] = [];
  for (const row of rows) {
    let subscription: PushSubscriptionData;
    try {
      subscription = JSON.parse(
        deps.box.decrypt(row.subscription, pushContext(row.userId)),
      ) as PushSubscriptionData;
    } catch {
      gone.push(row.id); // unreadable (old key removed): the device subscribes again
      continue;
    }
    const result = await deps.push.send(subscription, message);
    if (result === "sent") {
      sent += 1;
      await deps.db
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date() })
        .where(eq(pushSubscriptions.id, row.id));
    } else if (result === "gone") {
      gone.push(row.id);
    }
  }
  if (gone.length) {
    await deps.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  }
  return { sent, removed: gone.length };
}
