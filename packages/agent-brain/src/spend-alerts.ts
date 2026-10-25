import {
  member,
  organization,
  spendAlerts,
  tenants,
  user,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, eq, inArray } from "drizzle-orm";
import type { NotificationPlan, OutgoingMessage } from "./notifications";
import { ALERT_LEVELS, SPEND_CATEGORIES, spendStatus, type SpendCategory } from "./spend";

/**
 * Spending alerts (ADR 0022): at 80% and 100% of a monthly cap, owners and admins get one
 * email per category per month; at 100% the platform owners hear too. Runs on the workers'
 * 15-minute tick; `spend_alerts` (unique per business, month, category, level) makes each
 * alert go out once even with several workers.
 */

const LABEL: Record<SpendCategory, string> = { ai: "AI", sms: "texts", calls: "calls" };
const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export async function planSpendAlerts(
  db: Database,
  now: Date,
  webOrigin: string,
  /** Limit to these businesses (tests); by default every business. */
  only?: string[],
): Promise<Array<{ tenantId: string; plan: NotificationPlan }>> {
  // The auth table lists every business without crossing tenants under RLS.
  const all = await db
    .select({ id: organization.id })
    .from(organization)
    .where(only ? inArray(organization.id, only) : undefined);
  const platformOwners = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.isPlatformOwner, true));
  const out: Array<{ tenantId: string; plan: NotificationPlan }> = [];

  for (const { id: tenantId } of all) {
    const status = await spendStatus(db, tenantId, now);
    const due: Array<{ category: SpendCategory; level: number }> = [];
    for (const category of SPEND_CATEGORIES) {
      const { spent, cap } = status.categories[category];
      if (cap <= 0) continue; // the business chose "none": nothing to warn about
      // Only the highest level reached this run, so a jump straight to 100% sends one email.
      const level = [...ALERT_LEVELS].reverse().find((l) => spent >= (cap * l) / 100);
      if (!level) continue;
      const claimed = await withTenant(db, tenantId, (tx) =>
        tx
          .insert(spendAlerts)
          .values({ tenantId, month: status.month, category, level })
          .onConflictDoNothing()
          .returning({ id: spendAlerts.id }),
      );
      if (claimed.length > 0) due.push({ category, level });
    }
    if (due.length === 0) continue;

    const [business] = await withTenant(db, tenantId, (tx) =>
      tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)),
    );
    const team = await db
      .select({ email: user.email, userId: user.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, tenantId), inArray(member.role, ["owner", "admin"])));
    const link = status.businessCaps
      ? `${webOrigin}/t/${tenantId}/usage`
      : `${webOrigin}/t/${tenantId}/billing`;
    const messages: OutgoingMessage[] = [];
    for (const { category, level } of due) {
      const { spent, cap } = status.categories[category];
      const reached = level >= 100;
      const more = status.businessCaps
        ? "An owner can raise the limit"
        : "Upgrade your plan for a bigger allowance";
      const what = LABEL[category];
      const noun = status.businessCaps ? "limit" : "allowance";
      const subject = reached
        ? `${business?.name ?? "Your business"}: this month's ${what} ${noun} is used up`
        : `${business?.name ?? "Your business"}: ${level}% of this month's ${what} ${noun} used`;
      const until = status.businessCaps
        ? "until next month or until the limit is raised"
        : "until next month or until you upgrade your plan";
      const effect =
        category === "ai"
          ? `The assistant now takes messages instead of answering questions, ${until}.`
          : category === "sms"
            ? `Texts (confirmations, reminders, alerts) have stopped ${until}.`
            : `Outbound calls have stopped ${until}. Incoming calls are still answered.`;
      const text = [
        `${pounds(spent)} of the ${pounds(cap)} monthly ${what} ${noun} has been used.`,
        "",
        reached ? effect : "When it's reached: " + effect.charAt(0).toLowerCase() + effect.slice(1),
        "",
        `${more}: ${link}`,
      ].join("\n");
      for (const r of team) {
        messages.push({ channel: "email", to: r.email, subject, text, kind: "spend.alert" });
        // Phones (ADR 0024): the subject only (business name and allowance, no customer data).
        messages.push({
          channel: "push",
          to: r.userId,
          subject: business?.name ?? "VoiceDesk",
          text: subject.replace(/^.*?: /, ""),
          path: new URL(link).pathname,
          urgent: reached,
          tag: `spend-${category}`,
          kind: "spend.alert",
        });
      }
      if (reached) {
        for (const p of platformOwners) {
          messages.push({
            channel: "email",
            to: p.email,
            subject: `[Platform] ${subject}`,
            text,
            kind: "spend.alert",
          });
        }
      }
    }
    out.push({ tenantId, plan: { messages } });
  }
  return out;
}
