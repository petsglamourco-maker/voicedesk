import { getCountrySettings, textsAllowedTo } from "@voicedesk/core";
import {
  tenants,
  withTenant,
  type CountrySettings,
  type Database,
  type PlatformSpendSettings,
} from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { checkDestination, countryOfNumber } from "./destinations";
import { getPlatformSpendSettings, spendStatus } from "./spend";

/**
 * The one check every outbound text and call goes through (security audit H3/M10, ADR 0022):
 * platform pause switches, a suspended business, the business's monthly cap, and where the
 * number is (allowed country, not premium-rate). Never send or dial around it.
 */

export type SendRefusal =
  | "paused"
  | "suspended"
  | "cap"
  | "invalid"
  | "country"
  | "premium"
  /** ADR 0031: texts to a country that needs carrier registration first (US A2P 10DLC). */
  | "unregistered";

export type SendDecision = { ok: true } | { ok: false; reason: SendRefusal };

export async function checkSend(
  db: Database,
  params: {
    tenantId: string;
    kind: "sms" | "call";
    to: string;
    now?: Date;
    settings?: PlatformSpendSettings;
    /** Country launches and texting registration (tests pass their own; the row is shared). */
    countries?: CountrySettings;
  },
): Promise<SendDecision> {
  const settings = params.settings ?? (await getPlatformSpendSettings(db));
  if (params.kind === "sms" ? settings.paused.sms : settings.paused.outboundCalls) {
    return { ok: false, reason: "paused" };
  }
  const [tenant] = await withTenant(db, params.tenantId, (tx) =>
    tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, params.tenantId)),
  );
  if (tenant?.status === "suspended") return { ok: false, reason: "suspended" };
  const destination = checkDestination(params.to, settings.allowedCountries);
  if (!destination.ok) return destination;
  if (params.kind === "sms") {
    const countries = params.countries ?? (await getCountrySettings(db));
    if (!textsAllowedTo(countryOfNumber(params.to), countries)) {
      return { ok: false, reason: "unregistered" };
    }
  }
  const spend = await spendStatus(db, params.tenantId, params.now ?? new Date(), settings);
  const category = params.kind === "sms" ? "sms" : "calls";
  if (spend.categories[category].state === "reached") return { ok: false, reason: "cap" };
  return { ok: true };
}

export function sendRefusalMessage(reason: SendRefusal, kind: "sms" | "call"): string {
  const what = kind === "sms" ? "Texts" : "Outbound calls";
  switch (reason) {
    case "paused":
      return `${what} are paused on this service right now`;
    case "suspended":
      return "This business is suspended";
    case "cap":
      return `This month's ${kind === "sms" ? "texts" : "calls"} allowance is used up (Settings → Usage & limits)`;
    case "invalid":
      return "That phone number isn't valid";
    case "country":
      return `${what} to that country aren't allowed`;
    case "premium":
      return "Premium-rate and special-rate numbers can't be called or texted";
    case "unregistered":
      return "Texts to that country need carrier registration first (Platform admin → Countries)";
  }
}

/** Whether texts through this SMS provider cost money (Mailpit stand-ins don't). */
export function smsCostsMoney(providerName: string): boolean {
  return /twilio|telnyx/.test(providerName);
}
