import { ProviderError } from "../errors";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarProvider,
  CalendarSummary,
  TimeRange,
} from "./types";

/**
 * Microsoft 365 / Outlook calendars over Microsoft Graph (plain HTTPS, no SDK). Phase 3,
 * ADR 0014. Refresh tokens rotate: every refresh returns a new one, which must be saved
 * (`onRefreshToken`) or access lapses after about 90 days.
 */

export const MICROSOFT_CALENDAR_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
];

const PROVIDER = "microsoft-calendar";

export interface MicrosoftOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** "common" (work and personal accounts) unless restricted to one directory. */
  tenant?: string;
  fetch?: typeof fetch;
  authBaseUrl?: string;
}

export interface MicrosoftTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  email?: string;
}

async function failure(res: Response, what: string): Promise<ProviderError> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  return new ProviderError(PROVIDER, `${what}: HTTP ${res.status} ${body}`, {
    retryable: res.status === 429 || res.status >= 500,
  });
}

function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      preferred_username?: string;
    };
    return json.email ?? json.preferred_username;
  } catch {
    return undefined;
  }
}

export class MicrosoftOAuthClient {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly config: MicrosoftOAuthConfig) {
    this.fetchImpl = config.fetch ?? fetch;
    this.base =
      config.authBaseUrl ??
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenant ?? "common")}/oauth2/v2.0`;
  }

  /** `codeChallenge`: PKCE S256 challenge (security audit M7). */
  authorizeUrl(
    state: string,
    codeChallenge?: string,
    scopes: string[] = MICROSOFT_CALENDAR_SCOPES,
  ): string {
    const url = new URL(`${this.base}/authorize`);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: scopes.join(" "),
      prompt: "select_account",
      state,
      ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: "S256" } : {}),
    }).toString();
    return url.toString();
  }

  private async token(params: Record<string, string>): Promise<MicrosoftTokens> {
    const res = await this.fetchImpl(`${this.base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
        ...params,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
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

  exchangeCode(code: string, codeVerifier?: string): Promise<MicrosoftTokens> {
    return this.token({
      code,
      redirect_uri: this.config.redirectUri,
      grant_type: "authorization_code",
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    });
  }

  refresh(refreshToken: string): Promise<MicrosoftTokens> {
    return this.token({ refresh_token: refreshToken, grant_type: "refresh_token" });
  }

  /**
   * Microsoft has no endpoint to revoke a single app grant; the business removes VoiceDesk
   * under My Account → Apps. Disconnecting deletes our copy of the token.
   */
  revoke(): Promise<void> {
    return Promise.resolve();
  }
}

interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

/** Graph wants local date-times without an offset; we always send UTC. */
const toGraph = (d: Date): GraphDateTime => ({
  dateTime: d.toISOString().replace("Z", ""),
  timeZone: "UTC",
});
const fromGraph = (g: GraphDateTime): Date =>
  new Date(/[zZ]|[+-]\d\d:\d\d$/.test(g.dateTime) ? g.dateTime : `${g.dateTime}Z`);

interface GraphEvent {
  id: string;
  subject?: string;
  body?: { content?: string };
  start: GraphDateTime;
  end: GraphDateTime;
  showAs?: string;
  isCancelled?: boolean;
}

export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly name = PROVIDER;
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;
  private refreshToken: string;
  private access?: { token: string; expiresAt: number };

  constructor(
    private readonly options: {
      oauth: MicrosoftOAuthClient;
      refreshToken: string;
      /** Saves the rotated refresh token (encrypted) so access doesn't lapse. */
      onRefreshToken?: (refreshToken: string) => Promise<void>;
      fetch?: typeof fetch;
      apiUrl?: string;
    },
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.apiUrl = options.apiUrl ?? "https://graph.microsoft.com/v1.0";
    this.refreshToken = options.refreshToken;
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now()) return this.access.token;
    const tokens = await this.options.oauth.refresh(this.refreshToken);
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
    if (tokens.refreshToken && tokens.refreshToken !== this.refreshToken) {
      this.refreshToken = tokens.refreshToken;
      await this.options.onRefreshToken?.(tokens.refreshToken).catch(() => undefined);
    }
    return tokens.accessToken;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    return this.fetchImpl(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        authorization: `Bearer ${await this.accessToken()}`,
        prefer: 'outlook.timezone="UTC"',
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
  }

  async listCalendars(): Promise<CalendarSummary[]> {
    const res = await this.call("/me/calendars?$select=id,name,canEdit,isDefaultCalendar");
    if (!res.ok) throw await failure(res, "listing calendars failed");
    const body = (await res.json()) as {
      value?: Array<{ id: string; name: string; canEdit?: boolean; isDefaultCalendar?: boolean }>;
    };
    return (body.value ?? [])
      .filter((c) => c.canEdit !== false)
      .map((c) => ({ id: c.id, name: c.name, primary: c.isDefaultCalendar === true }));
  }

  async freeBusy(calendarIds: string[], window: TimeRange): Promise<TimeRange[]> {
    const ranges: TimeRange[] = [];
    for (const id of calendarIds) {
      const params = new URLSearchParams({
        startDateTime: window.start.toISOString(),
        endDateTime: window.end.toISOString(),
        $select: "start,end,showAs,isCancelled",
        $top: "200",
      });
      const res = await this.call(
        `/me/calendars/${encodeURIComponent(id)}/calendarView?${params.toString()}`,
      );
      if (!res.ok) throw await failure(res, "reading the calendar failed");
      const body = (await res.json()) as { value?: GraphEvent[] };
      for (const e of body.value ?? []) {
        // Events marked "free" (or cancelled) don't block a slot.
        if (e.isCancelled || e.showAs === "free") continue;
        ranges.push({ start: fromGraph(e.start), end: fromGraph(e.end) });
      }
    }
    return ranges.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  private body(event: Partial<CalendarEventInput>) {
    return {
      ...(event.title !== undefined ? { subject: event.title } : {}),
      ...(event.description !== undefined
        ? { body: { contentType: "text", content: event.description } }
        : {}),
      ...(event.start ? { start: toGraph(event.start) } : {}),
      ...(event.end ? { end: toGraph(event.end) } : {}),
      // No attendees: Outlook would email invitations; VoiceDesk sends its own confirmations.
    };
  }

  private toEvent(e: GraphEvent, fallback: Partial<CalendarEventInput>): CalendarEvent {
    return {
      id: e.id,
      title: e.subject ?? fallback.title ?? "",
      description: e.body?.content ?? fallback.description,
      start: e.start ? fromGraph(e.start) : fallback.start!,
      end: e.end ? fromGraph(e.end) : fallback.end!,
      timezone: fallback.timezone ?? "UTC",
    };
  }

  async createEvent(calendarId: string, event: CalendarEventInput): Promise<CalendarEvent> {
    const res = await this.call(`/me/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify(this.body(event)),
    });
    if (!res.ok) throw await failure(res, "creating the event failed");
    return this.toEvent((await res.json()) as GraphEvent, event);
  }

  async updateEvent(
    _calendarId: string,
    eventId: string,
    event: Partial<CalendarEventInput>,
  ): Promise<CalendarEvent> {
    const res = await this.call(`/me/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(this.body(event)),
    });
    if (!res.ok) throw await failure(res, "updating the event failed");
    return this.toEvent((await res.json()) as GraphEvent, event);
  }

  async deleteEvent(_calendarId: string, eventId: string): Promise<void> {
    const res = await this.call(`/me/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw await failure(res, "deleting the event failed");
  }
}
