import { describe, expect, it } from "vitest";
import {
  GoogleCalendarProvider,
  GoogleOAuthClient,
  isGoogleAuthRevoked,
} from "../src/calendar/google";
import { ProviderError } from "../src/errors";

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
}

/** Scripted fake of Google's token and Calendar endpoints. */
function fakeGoogle(options: { revoked?: boolean } = {}) {
  const calls: Call[] = [];
  let tokenCount = 0;
  const idToken = `x.${Buffer.from(JSON.stringify({ email: "owner@bright.example" })).toString("base64url")}.y`;
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const json = (status: number, body: unknown) =>
      Promise.resolve(Response.json(body, { status }));
    if (url.pathname === "/token") {
      if (options.revoked) return json(400, { error: "invalid_grant" });
      tokenCount++;
      const params = new URLSearchParams(call.body);
      return json(200, {
        access_token: `at-${tokenCount}`,
        expires_in: 3600,
        ...(params.get("grant_type") === "authorization_code"
          ? { refresh_token: "rt-1", id_token: idToken }
          : {}),
      });
    }
    if (url.pathname === "/calendar/v3/freeBusy") {
      return json(200, {
        calendars: {
          primary: {
            busy: [
              { start: "2026-10-20T13:00:00Z", end: "2026-10-20T14:00:00Z" },
              { start: "2026-10-20T09:00:00Z", end: "2026-10-20T09:30:00Z" },
            ],
          },
        },
      });
    }
    if (url.pathname === "/calendar/v3/users/me/calendarList") {
      return json(200, {
        items: [
          { id: "primary-id", summary: "owner@bright.example", primary: true },
          { id: "surgery", summary: "Surgery", summaryOverride: "Surgery diary" },
        ],
      });
    }
    if (url.pathname.endsWith("/events") && call.method === "POST") {
      const body = JSON.parse(call.body) as Record<string, unknown>;
      return json(200, { id: "evt-1", ...body });
    }
    if (url.pathname.endsWith("/events/evt-1") && call.method === "PATCH") {
      return json(200, {
        id: "evt-1",
        summary: "Check-up — Sam Patel",
        start: { dateTime: "2026-10-20T11:00:00Z" },
        end: { dateTime: "2026-10-20T11:30:00Z" },
      });
    }
    if (url.pathname.endsWith("/events/gone") && call.method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 410 }));
    }
    if (url.pathname.endsWith("/events/evt-1") && call.method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return json(500, { error: "unexpected" });
  }) as typeof fetch;
  return { impl, calls };
}

function setup(options: { revoked?: boolean } = {}) {
  const google = fakeGoogle(options);
  const base = "https://google.test";
  const oauth = new GoogleOAuthClient({
    clientId: "cid",
    clientSecret: "secret",
    redirectUri: "http://localhost:3000/api/integrations/google/callback",
    fetch: google.impl,
    tokenUrl: `${base}/token`,
    revokeUrl: `${base}/revoke`,
  });
  const calendar = new GoogleCalendarProvider({
    oauth,
    refreshToken: "rt-1",
    fetch: google.impl,
    apiUrl: `${base}/calendar/v3`,
  });
  return { ...google, oauth, calendar };
}

describe("GoogleOAuthClient", () => {
  it("builds an offline consent URL with state", () => {
    const { oauth } = setup();
    const url = new URL(oauth.authorizeUrl("state-123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "cid",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      state: "state-123",
    });
    expect(url.searchParams.get("scope")).toContain("calendar.events");
  });

  it("exchanges a code for a refresh token and the account email", async () => {
    const { oauth, calls } = setup();
    const tokens = await oauth.exchangeCode("code-1");
    expect(tokens).toMatchObject({ refreshToken: "rt-1", email: "owner@bright.example" });
    expect(new URLSearchParams(calls[0]!.body).get("grant_type")).toBe("authorization_code");
  });

  it("flags revoked access", async () => {
    const { oauth } = setup({ revoked: true });
    const err: unknown = await oauth.refresh("rt-old").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(isGoogleAuthRevoked(err)).toBe(true);
  });
});

describe("GoogleCalendarProvider", () => {
  it("reads busy times (sorted) with a cached access token", async () => {
    const { calendar, calls } = setup();
    const window = {
      start: new Date("2026-10-20T00:00:00Z"),
      end: new Date("2026-10-21T00:00:00Z"),
    };
    const busy = await calendar.freeBusy(["primary"], window);
    await calendar.freeBusy(["primary"], window);
    expect(busy.map((b) => b.start.toISOString())).toEqual([
      "2026-10-20T09:00:00.000Z",
      "2026-10-20T13:00:00.000Z",
    ]);
    expect(calls.filter((c) => c.url.pathname === "/token")).toHaveLength(1);
    const req = calls.find((c) => c.url.pathname.endsWith("/freeBusy"))!;
    expect(req.headers.authorization).toBe("Bearer at-1");
    expect(JSON.parse(req.body)).toMatchObject({ items: [{ id: "primary" }] });
  });

  it("lists writable calendars", async () => {
    const { calendar, calls } = setup();
    expect(await calendar.listCalendars()).toEqual([
      { id: "primary-id", name: "owner@bright.example", primary: true },
      { id: "surgery", name: "Surgery diary", primary: false },
    ]);
    expect(calls.at(-1)!.url.searchParams.get("minAccessRole")).toBe("writer");
  });

  it("creates, moves and deletes events without Google emailing anyone", async () => {
    const { calendar, calls } = setup();
    const created = await calendar.createEvent("primary", {
      title: "Check-up — Sam Patel",
      description: "Ref BD-7K4Q",
      start: new Date("2026-10-20T10:00:00Z"),
      end: new Date("2026-10-20T10:30:00Z"),
      timezone: "Europe/London",
    });
    expect(created.id).toBe("evt-1");
    const post = calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/events"))!;
    expect(post.url.searchParams.get("sendUpdates")).toBe("none");
    expect(JSON.parse(post.body)).toMatchObject({
      summary: "Check-up — Sam Patel",
      start: { dateTime: "2026-10-20T10:00:00.000Z", timeZone: "Europe/London" },
    });

    const moved = await calendar.updateEvent("primary", "evt-1", {
      start: new Date("2026-10-20T11:00:00Z"),
      end: new Date("2026-10-20T11:30:00Z"),
      timezone: "Europe/London",
    });
    expect(moved.start.toISOString()).toBe("2026-10-20T11:00:00.000Z");

    await calendar.deleteEvent("primary", "evt-1");
    await calendar.deleteEvent("primary", "gone"); // already deleted in Google: fine
  });
});
