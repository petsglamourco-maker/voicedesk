import { checkSend, sendRefusalMessage } from "@voicedesk/agent-brain";
import { can, type BusinessRole } from "@voicedesk/core";
import { agentSettings, withTenant, type Database } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { HttpError } from "./errors";

/**
 * Every call a person or the assistant places goes through here first (security audit H3,
 * ADR 0022): pause switch, suspension, the calls cap, and allowed destinations.
 */
export async function guardOutboundCall(db: Database, tenantId: string, to: string) {
  const decision = await checkSend(db, { tenantId, kind: "call", to });
  if (!decision.ok) {
    throw new HttpError(
      409,
      `CALL_${decision.reason.toUpperCase()}`,
      sendRefusalMessage(decision.reason, "call"),
    );
  }
}

/** Owners and admins may phone customers; staff and VAs only when the business allows it. */
export async function mayPhoneCustomers(
  db: Database,
  tenantId: string,
  role: BusinessRole,
): Promise<boolean> {
  if (can(role, "calls:outbound")) return true;
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ allowed: agentSettings.answerersCanCallOut })
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId)),
  );
  return row?.allowed === true;
}
