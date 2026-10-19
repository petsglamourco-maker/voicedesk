import { phoneNumbers, tenants, withPlatformAccess, type Database } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { HttpError, notFound } from "./errors";
import type { PhoneCarrier, SipGateway } from "./sip";

export type PhoneNumberRow = typeof phoneNumbers.$inferSelect;

/**
 * Registers a number bought in Twilio or Telnyx and routes its calls to a business: the row, then the
 * LiveKit inbound trunk and dispatch rule. If LiveKit fails, the row is removed again.
 * Used by Platform admin and the `number:add` script.
 */
export async function registerPhoneNumber(
  deps: { db: Database; sip: SipGateway },
  actorUserId: string,
  params: { e164: string; tenantId: string; label?: string | null; carrier?: PhoneCarrier },
): Promise<PhoneNumberRow> {
  const actor = { actorUserId, reason: "register phone number" };
  const row = await withPlatformAccess(deps.db, actor, async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, params.tenantId));
    if (!tenant) throw notFound();
    const [existing] = await tx
      .select({ id: phoneNumbers.id })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.e164, params.e164));
    if (existing) throw new HttpError(409, "NUMBER_EXISTS", "This number is already registered");
    const [inserted] = await tx
      .insert(phoneNumbers)
      .values({
        tenantId: params.tenantId,
        e164: params.e164,
        label: params.label ?? null,
        provider: params.carrier ?? "twilio",
      })
      .returning();
    return inserted!;
  });
  try {
    const route = await deps.sip.createRoute({
      e164: row.e164,
      carrier: carrierOf(row),
      metadata: { tenantId: row.tenantId, phoneNumberId: row.id },
    });
    const [routed] = await withPlatformAccess(deps.db, actor, (tx) =>
      tx
        .update(phoneNumbers)
        .set({ livekitTrunkId: route.trunkId, livekitDispatchRuleId: route.dispatchRuleId })
        .where(eq(phoneNumbers.id, row.id))
        .returning(),
    );
    return routed!;
  } catch (error) {
    await withPlatformAccess(deps.db, actor, (tx) =>
      tx.delete(phoneNumbers).where(eq(phoneNumbers.id, row.id)),
    );
    const failed = new HttpError(
      502,
      "SIP_ROUTE_FAILED",
      "LiveKit could not set up routing for this number",
    );
    failed.cause = error;
    throw failed;
  }
}

export function carrierOf(row: Pick<PhoneNumberRow, "provider">): PhoneCarrier {
  return row.provider === "telnyx" ? "telnyx" : "twilio";
}
