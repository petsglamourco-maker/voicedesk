import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CalendarProvider } from "@voicedesk/adapters";
import {
  GoogleCalendarProvider,
  GoogleOAuthClient,
  isGoogleAuthRevoked,
} from "@voicedesk/adapters/calendar/google";
import { calendarConnections, withTenant, type Database } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import type { SecretBox } from "./secret-box";

/**
 * Calendar integrations (Phase 3, ADR 0014): OAuth connect flow, encrypted token storage and
 * a provider per business for the agent's availability and bookings.
 */

export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";

export function googleOAuthFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleOAuthClient | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const origin = env.WEB_ORIGIN ?? "http://localhost:3000";
  return new GoogleOAuthClient({
    clientId,
    clientSecret,
    redirectUri: `${origin}${GOOGLE_CALLBACK_PATH}`,
  });
}

// --- OAuth state: signed, expiring, and bound to the browser by a nonce cookie -------------

export interface OAuthState {
  tenantId: string;
  userId: string;
  nonce: string;
  exp: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createOAuthState(
  secret: string,
  tenantId: string,
  userId: string,
  now: number = Date.now(),
): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ tenantId, userId, nonce, exp: now + STATE_TTL_MS } satisfies OAuthState),
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

export async function getCalendarConnection(
  db: Database,
  tenantId: string,
  provider = "google",
): Promise<CalendarConnectionRow | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(calendarConnections)
      .where(
        and(eq(calendarConnections.tenantId, tenantId), eq(calendarConnections.provider, provider)),
      ),
  );
  return row ?? null;
}

/** Creates or replaces the business's Google connection (reconnecting keeps the chosen calendar). */
export async function saveGoogleConnection(
  db: Database,
  box: SecretBox,
  params: { tenantId: string; userId: string; refreshToken: string; accountEmail?: string },
): Promise<CalendarConnectionRow> {
  const encrypted = box.encrypt(params.refreshToken, tokenContext(params.tenantId, "google"));
  const [row] = await withTenant(db, params.tenantId, (tx) =>
    tx
      .insert(calendarConnections)
      .values({
        tenantId: params.tenantId,
        provider: "google",
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

export async function chooseCalendar(
  db: Database,
  tenantId: string,
  calendar: { id: string; name: string },
): Promise<CalendarConnectionRow | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .update(calendarConnections)
      .set({ calendarId: calendar.id, calendarName: calendar.name, updatedAt: new Date() })
      .where(
        and(eq(calendarConnections.tenantId, tenantId), eq(calendarConnections.provider, "google")),
      )
      .returning(),
  );
  return row ?? null;
}

export async function deleteCalendarConnection(
  db: Database,
  tenantId: string,
  provider = "google",
): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx
      .delete(calendarConnections)
      .where(
        and(eq(calendarConnections.tenantId, tenantId), eq(calendarConnections.provider, provider)),
      ),
  );
}

export function decryptRefreshToken(box: SecretBox, row: CalendarConnectionRow): string {
  return box.decrypt(row.refreshTokenEncrypted, tokenContext(row.tenantId, row.provider));
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
        status: isGoogleAuthRevoked(error) ? "revoked" : "error",
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

/** Factory seam so tests can swap in an in-memory calendar. */
export type CalendarFactory = (
  row: CalendarConnectionRow,
  refreshToken: string,
) => CalendarProvider;

export function googleCalendarFactory(oauth: GoogleOAuthClient): CalendarFactory {
  return (_row, refreshToken) => new GoogleCalendarProvider({ oauth, refreshToken });
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
    provider: factory(row, decryptRefreshToken(box, row)),
  };
}
