import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CalendarProvider } from "@voicedesk/adapters";
import { GoogleCalendarProvider, GoogleOAuthClient } from "@voicedesk/adapters/calendar/google";
import {
  MicrosoftCalendarProvider,
  MicrosoftOAuthClient,
} from "@voicedesk/adapters/calendar/microsoft";
import { calendarConnections, withTenant, type Database } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { recordAudit } from "./audit";
import type { SecretBox } from "./secret-box";

/**
 * Calendar integrations (Phase 3, ADR 0014): OAuth connect flow, encrypted token storage and
 * a provider per business for the agent's availability and bookings. One connected calendar
 * per business (Google or Microsoft 365), so there's a single source of truth.
 */

export const CALENDAR_PROVIDERS = ["google", "microsoft"] as const;
export type CalendarProviderKey = (typeof CALENDAR_PROVIDERS)[number];

export function isCalendarProvider(value: string): value is CalendarProviderKey {
  return (CALENDAR_PROVIDERS as readonly string[]).includes(value);
}

export const calendarCallbackPath = (provider: CalendarProviderKey) =>
  `/api/integrations/${provider}/callback`;

/** The OAuth parts the connect flow needs (Google and Microsoft clients both fit). */
export interface CalendarOAuthClient {
  authorizeUrl(state: string, codeChallenge?: string): string;
  exchangeCode(
    code: string,
    codeVerifier?: string,
  ): Promise<{ refreshToken?: string; email?: string }>;
  revoke(token: string): Promise<void>;
}

/**
 * Builds a business's calendar from its stored connection. `saveRefreshToken` persists
 * rotated refresh tokens (Microsoft rotates them on every refresh).
 */
export type CalendarFactory = (
  row: CalendarConnectionRow,
  refreshToken: string,
  saveRefreshToken?: (token: string) => Promise<void>,
) => CalendarProvider;

export interface CalendarIntegrations {
  oauth: Partial<Record<CalendarProviderKey, CalendarOAuthClient>>;
  factory: CalendarFactory | null;
}

/** OAuth clients for the providers configured in .env, and a factory that uses them. */
export function calendarsFromEnv(env: NodeJS.ProcessEnv = process.env): CalendarIntegrations {
  const origin = env.WEB_ORIGIN ?? "http://localhost:3000";
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? new GoogleOAuthClient({
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: `${origin}${calendarCallbackPath("google")}`,
        })
      : undefined;
  const microsoft =
    env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
      ? new MicrosoftOAuthClient({
          clientId: env.MICROSOFT_CLIENT_ID,
          clientSecret: env.MICROSOFT_CLIENT_SECRET,
          redirectUri: `${origin}${calendarCallbackPath("microsoft")}`,
          tenant: env.MICROSOFT_TENANT || undefined,
        })
      : undefined;
  const factory: CalendarFactory = (row, refreshToken, saveRefreshToken) => {
    if (row.provider === "google" && google) {
      return new GoogleCalendarProvider({ oauth: google, refreshToken });
    }
    if (row.provider === "microsoft" && microsoft) {
      return new MicrosoftCalendarProvider({
        oauth: microsoft,
        refreshToken,
        onRefreshToken: saveRefreshToken,
      });
    }
    throw new Error(`${row.provider} calendar isn't configured on this server`);
  };
  return {
    oauth: { ...(google ? { google } : {}), ...(microsoft ? { microsoft } : {}) },
    factory: google || microsoft ? factory : null,
  };
}

// --- OAuth state: signed, expiring, and bound to the browser by a nonce cookie -------------

export interface OAuthState {
  tenantId: string;
  userId: string;
  provider: string;
  nonce: string;
  exp: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createOAuthState(
  secret: string,
  params: { tenantId: string; userId: string; provider: string },
  now: number = Date.now(),
): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ ...params, nonce, exp: now + STATE_TTL_MS } satisfies OAuthState),
  ).toString("base64url");
  return { state: `${payload}.${sign(payload, secret)}`, nonce };
}

/** Null unless the signature is valid, it hasn't expired and the nonce matches the cookie. */
export function verifyOAuthState(
  secret: string,
  state: string,
  nonceCookie: string | undefined,
  now: number = Date.now(),
): OAuthState | null {
  const [payload, mac] = state.split(".");
  if (!payload || !mac || !nonceCookie) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (parsed.exp < now || parsed.nonce !== nonceCookie) return null;
    return parsed;
  } catch {
    return null;
  }
}

// --- Stored connections -----------------------------------------------------------------

export type CalendarConnectionRow = typeof calendarConnections.$inferSelect;

const tokenContext = (tenantId: string, provider: string) =>
  `calendar_connections:${tenantId}:${provider}`;

export interface CalendarConnectionView {
  id: string;
  provider: string;
  accountEmail: string | null;
  calendarId: string | null;
  calendarName: string | null;
  status: string;
  lastError: string | null;
  lastErrorAt: Date | null;
}

export function toConnectionView(row: CalendarConnectionRow): CalendarConnectionView {
  return {
    id: row.id,
    provider: row.provider,
    accountEmail: row.accountEmail,
    calendarId: row.calendarId,
    calendarName: row.calendarName,
    status: row.status,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
  };
}

/** The business's connected calendar, whichever provider. */
export async function getCalendarConnection(
  db: Database,
  tenantId: string,
): Promise<CalendarConnectionRow | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(calendarConnections).where(eq(calendarConnections.tenantId, tenantId)),
  );
  return row ?? null;
}

/** Creates or replaces the business's connection (reconnecting keeps the chosen calendar). */
export async function saveCalendarConnection(
  db: Database,
  box: SecretBox,
  params: {
    tenantId: string;
    provider: CalendarProviderKey;
    userId: string;
    refreshToken: string;
    accountEmail?: string;
  },
): Promise<CalendarConnectionRow> {
  const encrypted = box.encrypt(
    params.refreshToken,
    tokenContext(params.tenantId, params.provider),
  );
  const [row] = await withTenant(db, params.tenantId, (tx) =>
    tx
      .insert(calendarConnections)
      .values({
        tenantId: params.tenantId,
        provider: params.provider,
        accountEmail: params.accountEmail ?? null,
        refreshTokenEncrypted: encrypted,
        status: "active",
        connectedBy: params.userId,
      })
      .onConflictDoUpdate({
        target: [calendarConnections.tenantId, calendarConnections.provider],
        set: {
          accountEmail: params.accountEmail ?? null,
          refreshTokenEncrypted: encrypted,
          status: "active",
          lastError: null,
          lastErrorAt: null,
          connectedBy: params.userId,
          updatedAt: new Date(),
        },
      })
      .returning(),
  );
  return row!;
}

/** Kept for existing callers and tests. */
export function saveGoogleConnection(
  db: Database,
  box: SecretBox,
  params: { tenantId: string; userId: string; refreshToken: string; accountEmail?: string },
): Promise<CalendarConnectionRow> {
  return saveCalendarConnection(db, box, { ...params, provider: "google" });
}

export async function chooseCalendar(
  db: Database,
  tenantId: string,
  calendar: { id: string; name: string },
): Promise<CalendarConnectionRow | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .update(calendarConnections)
      .set({ calendarId: calendar.id, calendarName: calendar.name, updatedAt: new Date() })
      .where(eq(calendarConnections.tenantId, tenantId))
      .returning(),
  );
  return row ?? null;
}

export async function deleteCalendarConnection(db: Database, tenantId: string): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx.delete(calendarConnections).where(eq(calendarConnections.tenantId, tenantId)),
  );
}

export function decryptRefreshToken(box: SecretBox, row: CalendarConnectionRow): string {
  return box.decrypt(row.refreshTokenEncrypted, tokenContext(row.tenantId, row.provider));
}

/** Saves a rotated refresh token (Microsoft). */
export async function updateRefreshToken(
  db: Database,
  box: SecretBox,
  row: CalendarConnectionRow,
  refreshToken: string,
): Promise<void> {
  await withTenant(db, row.tenantId, (tx) =>
    tx
      .update(calendarConnections)
      .set({
        refreshTokenEncrypted: box.encrypt(refreshToken, tokenContext(row.tenantId, row.provider)),
      })
      .where(eq(calendarConnections.id, row.id)),
  );
}

/** "invalid_grant" from either provider: access was revoked or expired; reconnect needed. */
export function isCalendarAuthRevoked(error: unknown): boolean {
  return error instanceof Error && /invalid_grant/.test(error.message);
}

/** Records a failure on the card; revoked access means the business must reconnect. */
export async function markCalendarError(
  db: Database,
  tenantId: string,
  connectionId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(calendarConnections)
      .set({
        status: isCalendarAuthRevoked(error) ? "revoked" : "error",
        lastError: message,
        lastErrorAt: new Date(),
      })
      .where(eq(calendarConnections.id, connectionId)),
  );
}

export async function markCalendarHealthy(
  db: Database,
  tenantId: string,
  connectionId: string,
): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(calendarConnections)
      .set({ status: "active", lastError: null, lastErrorAt: null })
      .where(eq(calendarConnections.id, connectionId)),
  );
}

export interface TenantCalendar {
  connectionId: string;
  calendarId: string;
  provider: CalendarProvider;
}

/**
 * The calendar the agent books into, or null (not connected, no calendar chosen, revoked,
 * or encryption not configured): the agent then uses VoiceDesk's own bookings only.
 */
export async function tenantCalendar(
  db: Database,
  box: SecretBox | null,
  factory: CalendarFactory | null,
  tenantId: string,
): Promise<TenantCalendar | null> {
  if (!box || !factory) return null;
  const row = await getCalendarConnection(db, tenantId);
  if (!row?.calendarId || row.status === "revoked") return null;
  return {
    connectionId: row.id,
    calendarId: row.calendarId,
    provider: factory(row, decryptRefreshToken(box, row), (token) =>
      updateRefreshToken(db, box, row, token),
    ),
  };
}

/**
 * When someone leaves a business, a calendar they connected (their own Google or Microsoft
 * account) stops being used: the token is revoked where possible and our copy deleted
 * (security audit M7). Returns the provider that was disconnected, if any.
 */
export async function disconnectCalendarOf(
  db: Database,
  box: SecretBox | null,
  oauth: Partial<Record<CalendarProviderKey, CalendarOAuthClient>>,
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const row = await getCalendarConnection(db, tenantId);
  if (!row || row.connectedBy !== userId) return null;
  const client = isCalendarProvider(row.provider) ? oauth[row.provider] : undefined;
  if (client && box) await client.revoke(decryptRefreshToken(box, row)).catch(() => undefined);
  await deleteCalendarConnection(db, tenantId);
  await withTenant(db, tenantId, (tx) =>
    recordAudit(tx, {
      tenantId,
      actorType: "system",
      actorUserId: null,
      action: "integration.calendar_disconnected",
      targetType: "user",
      targetId: userId,
      metadata: { provider: row.provider, reason: "member_removed" },
    }),
  );
  return row.provider;
}
