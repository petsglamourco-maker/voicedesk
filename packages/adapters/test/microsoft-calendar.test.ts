import { describe, expect, it } from "vitest";
import { MicrosoftCalendarProvider, MicrosoftOAuthClient } from "../src/calendar/microsoft";

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
}

function fakeGraph() {
  const calls: Call[] = [];
  let refreshes = 0;
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));
    if (url.pathname.endsWith("/token")) {
      refreshes++;
      return json({
        access_token: `at-${refreshes}`,
        expires_in: 3600,
        refresh_token: `rt-${refreshes + 1}`,
      });
    }
    if (url.pathname.endsWith("/me/calendars")) {
      return json({
        value: [
          { id: "cal-1", name: "Calendar", canEdit: true, isDefaultCalendar: true },
          { id: "holidays", name: "UK Holidays", canEdit: false },
        ],
      });
    }
    if (url.pathname.endsWith("/calendarView")) {
      return json({
        value: [
          {
            start: { dateTime: "2026-10-20T13:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2026-10-20T14:00:00.0000000", timeZone: "UTC" },
            showAs: "busy",
          },
          {
            start: { dateTime: "2026-10-20T09:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2026-10-20T09:30:00.0000000", timeZone: "UTC" },
            showAs: "free",
          },
          {
            start: { dateTime: "2026-10-20T10:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2026-10-20T10:30:00.0000000", timeZone: "UTC" },
            showAs: "busy",
            isCancelled: true,
          },
        ],
      });
    }
    if (url.pathname.endsWith("/events") && call.method === "POST") {
      return json({ id: "evt-1", ...(JSON.parse(call.body) as object) }, 201);
    }
    if (url.pathname.endsWith("/events/evt-1") && call.method === "PATCH") {
      return json({ id: "evt-1", ...(JSON.parse(call.body) as object) });
    }
    if (url.pathname.endsWith("/events/gone") && call.method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    if (call.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    return json({ error: "unexpected" }, 500);
  }) as typeof fetch;
  return { impl, calls };
}

function setup() {
  const graph = fakeGraph();
  const saved: string[] = [];
  const oauth = new MicrosoftOAuthClient({
    clientId: "cid",
    clientSecret: "secret",
    redirectUri: "http://localhost:3000/api/integrations/microsoft/callback",
    fetch: graph.impl,
    authBaseUrl: "https://login.test/common/oauth2/v2.0",
  });
  const calendar = new MicrosoftCalendarProvider({
    oauth,
    refreshToken: "rt-1",
    onRefreshToken: (t) => Promise.resolve(void saved.push(t)),
    fetch: graph.impl,
    apiUrl: "https://graph.test/v1.0",
  });
  return { ...graph, oauth, calendar, saved };
}

describe("MicrosoftOAuthClient", () => {
  it("asks for offline access to calendars", () => {
    const url = new URL(setup().oauth.authorizeUrl("st"));
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("Calendars.ReadWrite");
    expect(url.searchParams.get("state")).toBe("st");
  });
});

describe("MicrosoftCalendarProvider", () => {
  it("counts busy, non-cancelled events and saves the rotated refresh token", async () => {
    const { calendar, saved, calls } = setup();
    const busy = await calendar.freeBusy(["cal-1"], {
      start: new Date("2026-10-20T00:00:00Z"),
      end: new Date("2026-10-21T00:00:00Z"),
    });
    expect(busy.map((b) => b.start.toISOString())).toEqual(["2026-10-20T13:00:00.000Z"]);
    expect(saved).toEqual(["rt-2"]);
    const view = calls.find((c) => c.url.pathname.endsWith("/calendarView"))!;
    expect(view.headers.prefer).toBe('outlook.timezone="UTC"');
    expect(view.headers.authorization).toBe("Bearer at-1");
  });

  it("lists only calendars it can write to", async () => {
    expect(await setup().calendar.listCalendars()).toEqual([
      { id: "cal-1", name: "Calendar", primary: true },
    ]);
  });

  it("creates, moves and deletes events in UTC without inviting anyone", async () => {
    const { calendar, calls } = setup();
    const created = await calendar.createEvent("cal-1", {
      title: "Check-up — Sam Patel",
      description: "Ref BD-7K4Q",
      start: new Date("2026-10-20T10:00:00Z"),
      end: new Date("2026-10-20T10:30:00Z"),
      timezone: "Europe/London",
    });
    expect(created.id).toBe("evt-1");
    const post = JSON.parse(
      calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/events"))!.body,
    ) as Record<string, unknown>;
    expect(post).toEqual({
      subject: "Check-up — Sam Patel",
      body: { contentType: "text", content: "Ref BD-7K4Q" },
      start: { dateTime: "2026-10-20T10:00:00.000", timeZone: "UTC" },
      end: { dateTime: "2026-10-20T10:30:00.000", timeZone: "UTC" },
    });
    const moved = await calendar.updateEvent("cal-1", "evt-1", {
      start: new Date("2026-10-20T11:00:00Z"),
      end: new Date("2026-10-20T11:30:00Z"),
    });
    expect(moved.start.toISOString()).toBe("2026-10-20T11:00:00.000Z");
    await calendar.deleteEvent("cal-1", "evt-1");
    await calendar.deleteEvent("cal-1", "gone");
  });
});
