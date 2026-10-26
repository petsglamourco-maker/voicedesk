import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { LlmProvider } from "@voicedesk/adapters";
import {
  agentSettings,
  auditLog,
  businessProfiles,
  DEFAULT_PLATFORM_SPEND_SETTINGS,
  demoRequests,
  demos,
  knowledgeSources,
  llmUsage,
  organization,
  platformSettings,
  subscriptions,
  tenants,
  withPlatformAccess,
  withTenant,
  type Database,
  type DemoSettings,
} from "@voicedesk/db";
import { and, desc, eq, gte, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { BusinessProfile } from "./profile";
import { generateProfileDraft } from "./profile-generator";
import { getApprovedProfile } from "./profile-store";

/**
 * Instant demo (ADR 0029): a visitor types in their website and talks to an assistant built
 * from it. Each demo is a short-lived business on the "demo" plan (nothing can be sent from
 * it), with no members, deleted after DEMO_HOURS. The visitor holds a key
 * "<tenantId>.<random>"; only a hash of the random half is stored.
 */

export const DEMO_HOURS = 24;
export const DEMO_PAGES = 10;
export const DEMO_CHAT_TURNS = 20;
export const DEMO_VOICE_CALLS = 3;
export const DEMO_VOICE_SECONDS = 180;
/** The optional lead email is kept this long, then cleared. */
export const DEMO_LEAD_DAYS = 90;

export const DEFAULT_DEMO_SETTINGS: DemoSettings = { enabled: false, dailyLimit: 5 };

export type DemoStatus = "crawling" | "building" | "ready" | "failed";
export type DemoRow = typeof demos.$inferSelect;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function getDemoSettings(db: Database): Promise<DemoSettings> {
  const [row] = await db
    .select({ demos: platformSettings.demos })
    .from(platformSettings)
    .where(eq(platformSettings.id, "global"));
  return { ...DEFAULT_DEMO_SETTINGS, ...(row?.demos ?? {}) };
}

/** Platform owner only (callers check): switch demos on or off and set the daily limit. */
export async function saveDemoSettings(
  db: Database,
  settings: DemoSettings,
  actorUserId: string,
): Promise<void> {
  await withPlatformAccess(db, { actorUserId, reason: "demo settings" }, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({
        id: "global",
        spend: DEFAULT_PLATFORM_SPEND_SETTINGS,
        demos: settings,
        updatedBy: actorUserId,
      })
      .onConflictDoUpdate({
        target: platformSettings.id,
        set: { demos: settings, updatedBy: actorUserId, updatedAt: new Date() },
      });
  });
}

/** Demos created since the start of this UTC day (the daily limit). */
export async function demosToday(db: Database, now: Date = new Date()): Promise<number> {
  const start = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return withPlatformAccess(db, { actorUserId: null, reason: "demo daily limit" }, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(demoRequests)
      .where(gte(demoRequests.createdAt, start));
    return row?.n ?? 0;
  });
}

export interface CreateDemoInput {
  website: string;
  businessName: string;
  /** Only with the visitor's ticked consent. */
  email: string | null;
  ipHash: string | null;
  now?: Date;
}

/**
 * Creates the demo business (no members, demo plan, nothing switched on that could send)
 * and its website source. The caller starts the crawl. Returns the visitor's key.
 */
export async function createDemo(
  db: Database,
  input: CreateDemoInput,
): Promise<{ tenantId: string; sourceId: string; key: string; requestId: string }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + DEMO_HOURS * 3600 * 1000);
  const secret = randomBytes(24).toString("base64url");
  // The auth table (no RLS): a business with no members, marked as a demo.
  const [org] = await db
    .insert(organization)
    .values({
      name: input.businessName,
      slug: `demo-${randomBytes(6).toString("hex")}`,
      createdAt: now,
      metadata: JSON.stringify({ demo: true }),
    })
    .returning({ id: organization.id });
  const tenantId = org!.id;
  try {
    return await withPlatformAccess(
      db,
      { actorUserId: null, reason: "instant demo" },
      async (tx) => {
        await tx.insert(tenants).values({
          id: tenantId,
          name: input.businessName,
          countryCode: "GB",
          timezone: "Europe/London",
          defaultLanguage: "en",
          demoExpiresAt: expiresAt,
        });
        await tx.insert(subscriptions).values({ tenantId, planId: "demo", status: "active" });
        // Belt and braces: everything that could reach a customer or the team is off.
        await tx.insert(agentSettings).values({
          tenantId,
          customerConfirmations: false,
          reminderHours: 0,
          feedbackEnabled: false,
          dailyBrief: false,
          valueReport: false,
          voiceTyping: false,
        });
        const [request] = await tx
          .insert(demoRequests)
          .values({
            tenantId,
            website: input.website,
            businessName: input.businessName,
            email: input.email,
            consentAt: input.email ? now : null,
            ipHash: input.ipHash,
            createdAt: now,
          })
          .returning({ id: demoRequests.id });
        const [source] = await tx
          .insert(knowledgeSources)
          .values({
            tenantId,
            type: "website",
            title: new URL(input.website).hostname,
            url: input.website,
            settings: { pageLimit: DEMO_PAGES, recrawlDays: null },
          })
          .returning({ id: knowledgeSources.id });
        await tx.insert(demos).values({
          tenantId,
          tokenHash: hash(secret),
          website: input.website,
          requestId: request!.id,
          createdAt: now,
          expiresAt,
        });
        await tx.insert(auditLog).values({
          tenantId,
          actorType: "system",
          action: "demo.created",
          targetType: "tenant",
          targetId: tenantId,
          metadata: { requestId: request!.id },
        });
        return {
          tenantId,
          sourceId: source!.id,
          key: `${tenantId}.${secret}`,
          requestId: request!.id,
        };
      },
    );
  } catch (error) {
    await db.delete(organization).where(eq(organization.id, tenantId));
    throw error;
  }
}

/** The demo behind a visitor's key, or null (wrong key, expired or deleted). */
export async function findDemo(
  db: Database,
  key: string,
  now: Date = new Date(),
): Promise<DemoRow | null> {
  const [tenantId, secret] = key.split(".");
  if (!tenantId || !secret || !/^[0-9a-f-]{36}$/.test(tenantId)) return null;
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(demos).where(eq(demos.tenantId, tenantId)),
  );
  if (!row || row.expiresAt <= now) return null;
  const given = Buffer.from(hash(secret), "hex");
  const stored = Buffer.from(row.tokenHash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return null;
  return row;
}

/** Whether a business is an instant demo (and so must never send anything). */
export async function isDemoTenant(db: Database, tenantId: string): Promise<boolean> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx.select({ expires: tenants.demoExpiresAt }).from(tenants).where(eq(tenants.id, tenantId)),
  );
  return Boolean(row?.expires);
}

export async function setDemoStatus(
  db: Database,
  tenantId: string,
  status: DemoStatus,
  error: string | null = null,
): Promise<void> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .update(demos)
      .set({ status, error })
      .where(eq(demos.tenantId, tenantId))
      .returning({ requestId: demos.requestId }),
  );
  if (!row) return;
  await withPlatformAccess(db, { actorUserId: null, reason: "demo status" }, (tx) =>
    tx.update(demoRequests).set({ status }).where(eq(demoRequests.id, row.requestId)),
  );
}

/**
 * After the crawl: the profile is generated and, for demos only, approved straight away
 * (ADR 0011's human approval doesn't apply to a 24-hour demo of the visitor's own site).
 */
export async function buildDemoProfile(
  deps: { db: Database; llm: LlmProvider },
  tenantId: string,
): Promise<{ ok: boolean }> {
  if (!(await isDemoTenant(deps.db, tenantId))) return { ok: false };
  await setDemoStatus(deps.db, tenantId, "building");
  try {
    const { version } = await generateProfileDraft(deps, tenantId, null, {
      maxInputTokens: 20_000,
    });
    await withTenant(deps.db, tenantId, async (tx) => {
      await tx
        .update(businessProfiles)
        .set({ status: "approved", approvedAt: new Date() })
        .where(and(eq(businessProfiles.tenantId, tenantId), eq(businessProfiles.version, version)));
      await tx.insert(auditLog).values({
        tenantId,
        actorType: "system",
        action: "profile.approved",
        targetType: "business_profile",
        targetId: String(version),
        metadata: { demo: true },
      });
    });
    await setDemoStatus(deps.db, tenantId, "ready");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    await setDemoStatus(
      deps.db,
      tenantId,
      "failed",
      /knowledge/i.test(message) ? "no_pages" : "profile_failed",
    );
    return { ok: false };
  }
}

/** Three things to try, from the business's own profile (English, like the /try page). */
export function demoSuggestions(profile: BusinessProfile | null): string[] {
  const out: string[] = [];
  if (profile?.openingHours.some((h) => h.open)) out.push("What are your opening hours?");
  const priced = profile?.services.find((s) => s.price);
  if (priced) out.push(`How much is ${priced.name.toLowerCase()}?`);
  const bookable = profile?.services.find((s) => s.bookable);
  if (bookable) out.push(`Can I book ${bookable.name.toLowerCase()} for next week?`);
  for (const fallback of [
    "Where are you based?",
    "What do you offer?",
    "Can I leave a message for the owner?",
  ]) {
    if (out.length >= 3) break;
    out.push(fallback);
  }
  return out.slice(0, 3);
}

export async function demoProfile(db: Database, tenantId: string) {
  return getApprovedProfile(db, tenantId);
}

/**
 * Uses one of the demo's chat turns or voice calls. A conditional update, so parallel
 * requests can't go over the limit. Returns false when the limit is reached.
 */
export async function useDemoAllowance(
  db: Database,
  tenantId: string,
  kind: "chat" | "voice",
): Promise<boolean> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .update(demos)
      .set(
        kind === "chat"
          ? { chatTurns: sql`${demos.chatTurns} + 1` }
          : { voiceCalls: sql`${demos.voiceCalls} + 1` },
      )
      .where(
        and(
          eq(demos.tenantId, tenantId),
          kind === "chat"
            ? lt(demos.chatTurns, DEMO_CHAT_TURNS)
            : lt(demos.voiceCalls, DEMO_VOICE_CALLS),
        ),
      )
      .returning({ tenantId: demos.tenantId }),
  );
  return rows.length > 0;
}

/**
 * Deletes expired demo businesses (the cascade removes everything in them), after copying
 * their AI spend to demo_requests, and clears lead emails older than DEMO_LEAD_DAYS.
 */
export async function purgeExpiredDemos(
  db: Database,
  now: Date = new Date(),
  /** Limit to these businesses (tests); by default every expired demo. */
  only?: string[],
): Promise<{ purged: number; leadsCleared: number }> {
  const expired = await withPlatformAccess(db, { actorUserId: null, reason: "demo purge" }, (tx) =>
    tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(isNotNull(tenants.demoExpiresAt), lte(tenants.demoExpiresAt, now))),
  );
  let purged = 0;
  for (const { id } of expired) {
    if (only && !only.includes(id)) continue;
    const { cost, demo } = await withTenant(db, id, async (tx) => ({
      cost: (
        await tx
          .select({ usd: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)::float` })
          .from(llmUsage)
          .where(eq(llmUsage.tenantId, id))
      )[0]?.usd,
      demo: (await tx.select().from(demos).where(eq(demos.tenantId, id)))[0],
    }));
    await withPlatformAccess(db, { actorUserId: null, reason: "demo purge" }, async (tx) => {
      if (demo) {
        await tx
          .update(demoRequests)
          .set({
            costUsd: String(cost ?? 0),
            usage: { chatTurns: demo.chatTurns, voiceCalls: demo.voiceCalls },
            purgedAt: now,
          })
          .where(eq(demoRequests.id, demo.requestId));
      }
      // Only demo businesses: the row must still carry its expiry.
      const [check] = await tx
        .select({ expires: tenants.demoExpiresAt })
        .from(tenants)
        .where(eq(tenants.id, id));
      if (!check?.expires) return;
      await tx.delete(organization).where(eq(organization.id, id));
    });
    purged++;
  }
  const leadCutoff = new Date(now.getTime() - DEMO_LEAD_DAYS * 24 * 3600 * 1000);
  const cleared = await withPlatformAccess(
    db,
    { actorUserId: null, reason: "demo lead retention" },
    (tx) =>
      tx
        .update(demoRequests)
        .set({ email: null, consentAt: null })
        .where(and(isNotNull(demoRequests.email), lt(demoRequests.createdAt, leadCutoff)))
        .returning({ id: demoRequests.id }),
  );
  return { purged, leadsCleared: cleared.length };
}

export interface DemoOverview {
  settings: DemoSettings;
  today: number;
  monthCostUsd: number;
  requests: Array<{
    id: string;
    website: string;
    businessName: string | null;
    email: string | null;
    status: string;
    costUsd: number | null;
    createdAt: Date;
    purgedAt: Date | null;
  }>;
}

/** Platform admin → Demos (callers check the platform owner). */
export async function demoOverview(
  db: Database,
  actorUserId: string,
  now: Date = new Date(),
): Promise<DemoOverview> {
  const settings = await getDemoSettings(db);
  const monthStart = new Date(`${now.toISOString().slice(0, 7)}-01T00:00:00Z`);
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return withPlatformAccess(db, { actorUserId, reason: "demo overview" }, async (tx) => {
    const rows = await tx
      .select()
      .from(demoRequests)
      .orderBy(desc(demoRequests.createdAt))
      .limit(100);
    // Live demos' spend isn't copied in yet: add it from their usage rows.
    const [live] = await tx
      .select({ usd: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)::float` })
      .from(llmUsage)
      .innerJoin(demos, eq(demos.tenantId, llmUsage.tenantId))
      .where(gte(llmUsage.createdAt, monthStart));
    const [done] = await tx
      .select({ usd: sql<number>`coalesce(sum(${demoRequests.costUsd}), 0)::float` })
      .from(demoRequests)
      .where(and(gte(demoRequests.createdAt, monthStart), isNotNull(demoRequests.purgedAt)));
    return {
      settings,
      today: rows.filter((r) => r.createdAt >= dayStart).length,
      monthCostUsd: Math.round(((live?.usd ?? 0) + (done?.usd ?? 0)) * 10_000) / 10_000,
      requests: rows.map((r) => ({
        id: r.id,
        website: r.website,
        businessName: r.businessName,
        email: r.email,
        status: r.status,
        costUsd: r.costUsd === null ? null : Number(r.costUsd),
        createdAt: r.createdAt,
        purgedAt: r.purgedAt,
      })),
    };
  });
}

/** Platform owner: forget a lead's email (on request). */
export async function clearDemoLead(
  db: Database,
  requestId: string,
  actorUserId: string,
): Promise<boolean> {
  const rows = await withPlatformAccess(db, { actorUserId, reason: "demo lead removed" }, (tx) =>
    tx
      .update(demoRequests)
      .set({ email: null, consentAt: null })
      .where(and(eq(demoRequests.id, requestId), isNotNull(demoRequests.email)))
      .returning({ id: demoRequests.id }),
  );
  return rows.length > 0;
}
