import {
  agentSettings,
  conversations,
  DEFAULT_PLATFORM_SPEND_SETTINGS,
  llmUsage,
  platformSettings,
  spendEvents,
  tenants,
  withPlatformAccess,
  withTenant,
  type Database,
  type PlatformSpendSettings,
} from "@voicedesk/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { localDateString, zonedToUtc } from "./availability";

/**
 * Monthly spending limits (security batch 4, ADR 0022). Each business chooses caps for AI,
 * texts and calls within its allowance; spend is worked out from what's already recorded
 * (AI usage, call minutes) plus `spend_events` for texts, using the platform's cost estimates.
 */

export const SPEND_CATEGORIES = ["ai", "sms", "calls"] as const;
export type SpendCategory = (typeof SPEND_CATEGORIES)[number];
export type Pence = Record<SpendCategory, number>;

export const DEFAULT_CAPS: Pence = { ai: 2000, sms: 1000, calls: 2000 };
/** Alerts go to owners/admins at these percentages of a cap. */
export const ALERT_LEVELS = [80, 100] as const;

export async function getPlatformSpendSettings(db: Database): Promise<PlatformSpendSettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, "global"));
  const saved = row?.spend;
  const d = DEFAULT_PLATFORM_SPEND_SETTINGS;
  return {
    maxCapPence: { ...d.maxCapPence, ...saved?.maxCapPence },
    businessCaps: saved?.businessCaps ?? d.businessCaps,
    costs: { ...d.costs, ...saved?.costs },
    paused: { ...d.paused, ...saved?.paused },
    allowedCountries: saved?.allowedCountries ?? d.allowedCountries,
  };
}

/**
 * The most a business may set each cap to. Today: the platform maximum. With billing
 * (Phase 7) this becomes the business's subscription tier allowance — change only this.
 */
export async function allowanceFor(
  db: Database,
  _tenantId: string,
  settings?: PlatformSpendSettings,
): Promise<Pence> {
  return (settings ?? (await getPlatformSpendSettings(db))).maxCapPence;
}

function toStatus(
  month: string,
  spent: Pence,
  caps: Pence,
  allowance: Pence,
  businessCaps: boolean,
): SpendStatus {
  const categories = Object.fromEntries(
    SPEND_CATEGORIES.map((c) => {
      const cap = businessCaps ? Math.min(caps[c], allowance[c]) : allowance[c];
      return [c, { spent: spent[c], cap, state: stateFor(spent[c], cap) }];
    }),
  ) as SpendStatus["categories"];
  return { month, categories, allowance, businessCaps };
}

/** Start and end (exclusive) of the current calendar month in the business's time zone. */
export function monthWindow(now: Date, timeZone: string): { month: string; from: Date; to: Date } {
  const month = localDateString(now, timeZone).slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return {
    month,
    from: zonedToUtc(`${month}-01`, "00:00", timeZone),
    to: zonedToUtc(`${next}-01`, "00:00", timeZone),
  };
}

export async function monthSpend(
  db: Database,
  tenantId: string,
  now: Date = new Date(),
  settings?: PlatformSpendSettings,
): Promise<{ month: string; spent: Pence }> {
  const s = settings ?? (await getPlatformSpendSettings(db));
  return withTenant(db, tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const { month, from, to } = monthWindow(now, tenant?.timezone ?? "Europe/London");

    const [ai] = await tx
      .select({ usd: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)` })
      .from(llmUsage)
      .where(
        and(
          eq(llmUsage.tenantId, tenantId),
          gte(llmUsage.createdAt, from),
          lt(llmUsage.createdAt, to),
        ),
      );
    const [sms] = await tx
      .select({ pence: sql<string>`coalesce(sum(${spendEvents.amountPence}), 0)` })
      .from(spendEvents)
      .where(
        and(
          eq(spendEvents.tenantId, tenantId),
          eq(spendEvents.category, "sms"),
          gte(spendEvents.createdAt, from),
          lt(spendEvents.createdAt, to),
        ),
      );
    // Voice minutes, rounded up per call like carriers bill. Calls still going count so far.
    const minutes = sql<string>`coalesce(sum(ceil(extract(epoch from (coalesce(${conversations.endedAt}, now()) - ${conversations.startedAt})) / 60.0)), 0)`;
    const calls = await tx
      .select({
        phone: sql<boolean>`${conversations.phoneNumberId} is not null`,
        direction: conversations.direction,
        minutes,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.channel, "voice"),
          gte(conversations.startedAt, from),
          lt(conversations.startedAt, to),
        ),
      )
      .groupBy(sql`1`, conversations.direction);

    let callsPence = 0;
    for (const row of calls) {
      const mins = Number(row.minutes);
      const carrier = !row.phone
        ? 0
        : row.direction === "outbound"
          ? s.costs.phoneOutboundPencePerMinute
          : s.costs.phoneInboundPencePerMinute;
      callsPence += mins * (s.costs.voicePencePerMinute + carrier);
    }
    return {
      month,
      spent: {
        ai: Number(ai?.usd ?? 0) * 100 * s.costs.usdToGbp,
        sms: Number(sms?.pence ?? 0),
        calls: callsPence,
      },
    };
  });
}

export async function capsFor(db: Database, tenantId: string): Promise<Pence> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        ai: agentSettings.aiCapPence,
        sms: agentSettings.smsCapPence,
        calls: agentSettings.callsCapPence,
      })
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId)),
  );
  return row ?? DEFAULT_CAPS;
}

export type SpendState = "ok" | "warning" | "reached";

export interface SpendStatus {
  month: string;
  categories: Record<SpendCategory, { spent: number; cap: number; state: SpendState }>;
  allowance: Pence;
  /** Whether the business's own limits apply (the platform's `businessCaps` switch). */
  businessCaps: boolean;
}

export function stateFor(spent: number, cap: number): SpendState {
  if (spent >= cap) return "reached";
  if (spent >= cap * (ALERT_LEVELS[0] / 100)) return "warning";
  return "ok";
}

/**
 * This month's spend against the business's limit: its allowance (its plan), or, when the
 * platform lets businesses choose, their own cap within it.
 */
export async function spendStatus(
  db: Database,
  tenantId: string,
  now: Date = new Date(),
  platform?: PlatformSpendSettings,
): Promise<SpendStatus> {
  const settings = platform ?? (await getPlatformSpendSettings(db));
  const [{ month, spent }, caps, allowance] = await Promise.all([
    monthSpend(db, tenantId, now, settings),
    capsFor(db, tenantId),
    allowanceFor(db, tenantId, settings),
  ]);
  return toStatus(month, spent, caps, allowance, settings.businessCaps);
}

/**
 * Every business's spend this month in three grouped queries (Platform admin overview), each
 * business's month in its own time zone. Same rules as spendStatus.
 */
export async function spendOverview(
  db: Database,
  actorUserId: string,
  now: Date = new Date(),
): Promise<Array<{ tenantId: string; name: string; status: string; spend: SpendStatus }>> {
  const settings = await getPlatformSpendSettings(db);
  const inMonth = (column: unknown) =>
    sql`date_trunc('month', ${column} at time zone ${tenants.timezone}) = date_trunc('month', ${now} at time zone ${tenants.timezone})`;
  return withPlatformAccess(db, { actorUserId, reason: "spending overview" }, async (tx) => {
    const rows = await tx
      .select({
        id: tenants.id,
        name: tenants.name,
        status: tenants.status,
        timezone: tenants.timezone,
        ai: agentSettings.aiCapPence,
        sms: agentSettings.smsCapPence,
        calls: agentSettings.callsCapPence,
      })
      .from(tenants)
      .leftJoin(agentSettings, eq(agentSettings.tenantId, tenants.id))
      .orderBy(tenants.name);
    const ai = await tx
      .select({ id: llmUsage.tenantId, usd: sql<string>`sum(${llmUsage.costUsd})` })
      .from(llmUsage)
      .innerJoin(tenants, eq(tenants.id, llmUsage.tenantId))
      .where(inMonth(llmUsage.createdAt))
      .groupBy(llmUsage.tenantId);
    const sms = await tx
      .select({ id: spendEvents.tenantId, pence: sql<string>`sum(${spendEvents.amountPence})` })
      .from(spendEvents)
      .innerJoin(tenants, eq(tenants.id, spendEvents.tenantId))
      .where(and(eq(spendEvents.category, "sms"), inMonth(spendEvents.createdAt)))
      .groupBy(spendEvents.tenantId);
    const calls = await tx
      .select({
        id: conversations.tenantId,
        phone: sql<boolean>`${conversations.phoneNumberId} is not null`,
        direction: conversations.direction,
        minutes: sql<string>`sum(ceil(extract(epoch from (coalesce(${conversations.endedAt}, now()) - ${conversations.startedAt})) / 60.0))`,
      })
      .from(conversations)
      .innerJoin(tenants, eq(tenants.id, conversations.tenantId))
      .where(and(eq(conversations.channel, "voice"), inMonth(conversations.startedAt)))
      .groupBy(conversations.tenantId, sql`2`, conversations.direction);

    const aiBy = new Map(ai.map((r) => [r.id, Number(r.usd)]));
    const smsBy = new Map(sms.map((r) => [r.id, Number(r.pence)]));
    const callsBy = new Map<string, number>();
    for (const r of calls) {
      const carrier = !r.phone
        ? 0
        : r.direction === "outbound"
          ? settings.costs.phoneOutboundPencePerMinute
          : settings.costs.phoneInboundPencePerMinute;
      const pence = Number(r.minutes) * (settings.costs.voicePencePerMinute + carrier);
      callsBy.set(r.id, (callsBy.get(r.id) ?? 0) + pence);
    }
    const out = [];
    for (const t of rows) {
      const spent: Pence = {
        ai: (aiBy.get(t.id) ?? 0) * 100 * settings.costs.usdToGbp,
        sms: smsBy.get(t.id) ?? 0,
        calls: callsBy.get(t.id) ?? 0,
      };
      const caps: Pence = {
        ai: t.ai ?? DEFAULT_CAPS.ai,
        sms: t.sms ?? DEFAULT_CAPS.sms,
        calls: t.calls ?? DEFAULT_CAPS.calls,
      };
      const allowance = await allowanceFor(db, t.id, settings);
      out.push({
        tenantId: t.id,
        name: t.name,
        status: t.status,
        spend: toStatus(
          monthWindow(now, t.timezone).month,
          spent,
          caps,
          allowance,
          settings.businessCaps,
        ),
      });
    }
    return out;
  });
}

/** Records a text sent through a real carrier (one row per message). */
export async function recordSmsSpend(
  db: Database,
  tenantId: string,
  segments: number,
  settings?: PlatformSpendSettings,
): Promise<void> {
  const s = settings ?? (await getPlatformSpendSettings(db));
  await withTenant(db, tenantId, (tx) =>
    tx.insert(spendEvents).values({
      tenantId,
      category: "sms",
      units: segments,
      amountPence: segments * s.costs.smsPencePerSegment,
    }),
  );
}

/** GSM-7 texts are 160 characters (153 per part when split); anything else 70 (67). */
export function smsSegments(text: string): number {
  // eslint-disable-next-line no-control-regex
  const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]*$/.test(text);
  const [single, part] = gsm ? [160, 153] : [70, 67];
  return text.length <= single ? 1 : Math.ceil(text.length / part);
}
