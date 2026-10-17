import { ProviderError } from "../errors";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarProvider,
  CalendarSummary,
  TimeRange,
} from "./types";

/**
 * Google Calendar over plain HTTPS (OAuth 2.0 web-server flow + Calendar API v3), so we
 * don't pull in the googleapis SDK. Phase 3, ADR 0014.
 */

/** Book events, read free/busy and list calendars to choose from; email to show the account. */
export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
  /** Overridable for tests. */
  authUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
}

export interface GoogleTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  /** Account email from the ID token (shown on the integration card). */
  email?: string;
}

const PROVIDER = "google-calendar";

/** The user revoked access (or the token expired): the business must reconnect. */
export function isGoogleAuthRevoked(error: unknown): boolean {
  return error instanceof ProviderError && /invalid_grant/.test(error.message);
}

async function failure(res: Response, what: string): Promise<ProviderError> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  return new ProviderError(PROVIDER, `${what}: HTTP ${res.status} ${body}`, {
    retryable: res.status === 429 || res.status >= 500,
  });
}

/** Reads the email claim from an ID token received directly from Google's token endpoint. */
function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
    };
    return json.email;
  } catch {
    return undefined;
  }
}

export class GoogleOAuthClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GoogleOAuthConfig) {
    this.fetchImpl = config.fetch ?? fetch;
  }

  authorizeUrl(state: string, scopes: string[] = GOOGLE_CALENDAR_SCOPES): string {
    const url = new URL(this.config.authUrl ?? "https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      // Always ask, so Google always returns a refresh token (only sent on consent).
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return url.toString();
  }

  private async token(params: Record<string, string>): Promise<GoogleTokens> {
    const res = await this.fetchImpl(
      this.config.tokenUrl ?? "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          ...params,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) throw await failure(res, "token request failed");
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      id_token?: string;
    };
    return {
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in - 60) * 1000,
      refreshToken: body.refresh_token,
      email: emailFromIdToken(body.id_token),
    };
  }

  exchangeCode(code: string): Promise<GoogleTokens> {
    return this.token({
      code,
      redirect_uri: this.config.redirectUri,
      grant_type: "authorization_code",
    });
  }

  refresh(refreshToken: string): Promise<GoogleTokens> {
    return this.token({ refresh_token: refreshToken, grant_type: "refresh_token" });
  }

  /** Best effort: a token Google already dropped is fine. */
  async revoke(token: string): Promise<void> {
    await this.fetchImpl(this.config.revokeUrl ?? "https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; timeZone?: string };
  end: { dateTime?: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string }>;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = PROVIDER;
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;
  private access?: { token: string; expiresAt: number };

  constructor(
    private readonly options: {
      oauth: GoogleOAuthClient;
      refreshToken: string;
      fetch?: typeof fetch;
      apiUrl?: string;
    },
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.apiUrl = options.apiUrl ?? "https://www.googleapis.com/calendar/v3";
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now()) return this.access.token;
    const tokens = await this.options.oauth.refresh(this.options.refreshToken);
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
    return tokens.accessToken;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        authorization: `Bearer ${await this.accessToken()}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    return res;
  }

  async listCalendars(): Promise<CalendarSummary[]> {
    const res = await this.call("/users/me/calendarList?minAccessRole=writer");
    if (!res.ok) throw await failure(res, "listing calendars failed");
    const body = (await res.json()) as {
      items?: Array<{ id: string; summary?: string; summaryOverride?: string; primary?: boolean }>;
    };
    return (body.items ?? []).map((c) => ({
      id: c.id,
      name: c.summaryOverride ?? c.summary ?? c.id,
      primary: c.primary === true,
    }));
  }

  async freeBusy(calendarIds: string[], window: TimeRange): Promise<TimeRange[]> {
    const res = await this.call("/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: window.start.toISOString(),
        timeMax: window.end.toISOString(),
        items: calendarIds.map((id) => ({ id })),
      }),
    });
    if (!res.ok) throw await failure(res, "free/busy failed");
    const body = (await res.json()) as {
      calendars?: Record<
        string,
        { busy?: Array<{ start: string; end: string }>; errors?: Array<{ reason: string }> }
      >;
    };
    const ranges: TimeRange[] = [];
    for (const id of calendarIds) {
      const cal = body.calendars?.[id];
      if (cal?.errors?.length) {
        throw new ProviderError(
          PROVIDER,
          `free/busy error for calendar: ${cal.errors[0]!.reason}`,
          {
            retryable: false,
          },
        );
      }
      for (const b of cal?.busy ?? [])
        ranges.push({ start: new Date(b.start), end: new Date(b.end) });
    }
    return ranges.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  private toGoogle(event: Partial<CalendarEventInput>) {
    return {
      ...(event.title !== undefined ? { summary: event.title } : {}),
      ...(event.description !== undefined ? { description: event.description } : {}),
      ...(event.start
        ? { start: { dateTime: event.start.toISOString(), timeZone: event.timezone } }
        : {}),
      ...(event.end
        ? { end: { dateTime: event.end.toISOString(), timeZone: event.timezone } }
        : {}),
      ...(event.attendees
        ? { attendees: event.attendees.map((a) => ({ email: a.email, displayName: a.name })) }
        : {}),
    };
  }

  private fromGoogle(e: GoogleEvent, fallback: Partial<CalendarEventInput> = {}): CalendarEvent {
    return {
      id: e.id,
      title: e.summary ?? fallback.title ?? "",
      description: e.description ?? fallback.description,
      start: e.start.dateTime ? new Date(e.start.dateTime) : fallback.start!,
      end: e.end.dateTime ? new Date(e.end.dateTime) : fallback.end!,
      timezone: e.start.timeZone ?? fallback.timezone ?? "UTC",
      attendees: e.attendees?.map((a) => ({ email: a.email, name: a.displayName })),
    };
  }

  async createEvent(calendarId: string, event: CalendarEventInput): Promise<CalendarEvent> {
    // sendUpdates=none: we send our own confirmations; no Google invite emails to customers.
    const res = await this.call(
      `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
      { method: "POST", body: JSON.stringify(this.toGoogle(event)) },
    );
    if (!res.ok) throw await failure(res, "creating the event failed");
    return this.fromGoogle((await res.json()) as GoogleEvent, event);
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    event: Partial<CalendarEventInput>,
  ): Promise<CalendarEvent> {
    const res = await this.call(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
      { method: "PATCH", body: JSON.stringify(this.toGoogle(event)) },
    );
    if (!res.ok) throw await failure(res, "updating the event failed");
    return this.fromGoogle((await res.json()) as GoogleEvent, event);
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const res = await this.call(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
      { method: "DELETE" },
    );
    // Already deleted in Google: nothing to do.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw await failure(res, "deleting the event failed");
    }
  }
}
