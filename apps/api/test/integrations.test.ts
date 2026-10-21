import { InMemoryCalendarProvider } from "@voicedesk/adapters";
import { GoogleOAuthClient } from "@voicedesk/adapters/calendar/google";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cookieFrom,
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  type TestHarness,
} from "./harness";

const idToken = `x.${Buffer.from(JSON.stringify({ email: "owner@bright.example" })).toString("base64url")}.y`;
const revoked: string[] = [];
const fakeGoogleFetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : input.toString();
  if (url.endsWith("/revoke")) {
    revoked.push(new URLSearchParams(init?.body as string).get("token") ?? "");
    return Promise.resolve(new Response(null, { status: 200 }));
  }
  return Promise.resolve(
    Response.json({
      access_token: "at",
      expires_in: 3600,
      refresh_token: "rt-1",
      id_token: idToken,
    }),
  );
}) as typeof fetch;

const oauth = new GoogleOAuthClient({
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "http://localhost:3000/api/integrations/google/callback",
  fetch: fakeGoogleFetch,
  tokenUrl: "https://google.test/token",
  revokeUrl: "https://google.test/revoke",
});
const calendar = new InMemoryCalendarProvider();

let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;

beforeAll(async () => {
  h = await createHarness({ calendars: { oauth: { google: oauth }, factory: () => calendar } });
  owner = await createOwnerWithTenant(h, "Integrations Co");
});
afterAll(() => h.close());

const as = (cookie: string) => ({ cookie, origin: ORIGIN });
const base = () => `/api/tenants/${owner.tenantId}/integrations`;

async function startFlow(cookie: string) {
  const res = await h.app.inject({
    method: "GET",
    url: `${base()}/google/start`,
    headers: as(cookie),
  });
  expect(res.statusCode).toBe(302);
  const google = new URL(res.headers.location as string);
  return { state: google.searchParams.get("state")!, nonceCookie: cookieFrom(res), google };
}

describe("Google Calendar connection", () => {
  it("sends the owner to Google with a signed state", async () => {
    const { google, nonceCookie } = await startFlow(owner.cookie);
    expect(google.hostname).toBe("accounts.google.com");
    expect(google.searchParams.get("access_type")).toBe("offline");
    expect(nonceCookie).toMatch(/^vd_oauth_nonce=/);
  });

  it("rejects a callback without the browser's nonce (replay / CSRF)", async () => {
    const { state } = await startFlow(owner.cookie);
    const res = await h.app.inject({
      method: "GET",
      url: `/api/integrations/google/callback?code=c&state=${encodeURIComponent(state)}`,
      headers: as(owner.cookie),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a callback finished by a different user", async () => {
    const { state, nonceCookie } = await startFlow(owner.cookie);
    const other = await createOwnerWithTenant(h, "Someone Else");
    const res = await h.app.inject({
      method: "GET",
      url: `/api/integrations/google/callback?code=c&state=${encodeURIComponent(state)}`,
      headers: as(`${other.cookie}; ${nonceCookie}`),
    });
    expect(res.statusCode).toBe(400);
  });

  it("connects with the main calendar chosen, lets the owner pick another, and disconnects", async () => {
    const { state, nonceCookie } = await startFlow(owner.cookie);
    const done = await h.app.inject({
      method: "GET",
      url: `/api/integrations/google/callback?code=c&state=${encodeURIComponent(state)}`,
      headers: as(`${owner.cookie}; ${nonceCookie}`),
    });
    expect(done.statusCode).toBe(302);
    expect(done.headers.location).toBe(`/t/${owner.tenantId}/integrations?calendar=connected`);

    const status = await h.app.inject({ method: "GET", url: base(), headers: as(owner.cookie) });
    expect(status.json()).toMatchObject({
      calendar: {
        available: { google: true, microsoft: false },
        canManage: true,
        connection: {
          provider: "google",
          accountEmail: "owner@bright.example",
          calendarId: "primary",
          status: "active",
        },
      },
    });

    const list = await h.app.inject({
      method: "GET",
      url: `${base()}/calendar/calendars`,
      headers: as(owner.cookie),
    });
    expect(list.json<{ calendars: Array<{ id: string }> }>().calendars.map((c) => c.id)).toEqual([
      "primary",
      "team",
    ]);
    const bad = await h.app.inject({
      method: "PUT",
      url: `${base()}/calendar`,
      headers: as(owner.cookie),
      payload: { id: "someone-elses" },
    });
    expect(bad.statusCode).toBe(400);
    const chosen = await h.app.inject({
      method: "PUT",
      url: `${base()}/calendar`,
      headers: as(owner.cookie),
      payload: { id: "team" },
    });
    expect(chosen.json()).toMatchObject({ calendarId: "team", calendarName: "Team diary" });

    const other = await createOwnerWithTenant(h, "Nosy Co");
    const peek = await h.app.inject({ method: "GET", url: base(), headers: as(other.cookie) });
    expect(peek.statusCode).toBe(404);

    const notConfigured = await h.app.inject({
      method: "GET",
      url: `${base()}/microsoft/start`,
      headers: as(owner.cookie),
    });
    expect(notConfigured.statusCode).toBe(503); // Microsoft isn't configured in this harness

    const off = await h.app.inject({
      method: "DELETE",
      url: `${base()}/calendar`,
      headers: as(owner.cookie),
    });
    expect(off.statusCode).toBe(204);
    expect(revoked).toContain("rt-1");
    const after = await h.app.inject({ method: "GET", url: base(), headers: as(owner.cookie) });
    expect(after.json<{ calendar: { connection: unknown } }>().calendar.connection).toBeNull();
  });
});

describe("without Google configured", () => {
  it("says so instead of failing", async () => {
    const bare = await createHarness();
    const o = await createOwnerWithTenant(bare, "No Google Co");
    const status = await bare.app.inject({
      method: "GET",
      url: `/api/tenants/${o.tenantId}/integrations`,
      headers: as(o.cookie),
    });
    expect(status.json()).toMatchObject({
      calendar: { available: { google: false, microsoft: false } },
    });
    const start = await bare.app.inject({
      method: "GET",
      url: `/api/tenants/${o.tenantId}/integrations/google/start`,
      headers: as(o.cookie),
    });
    expect(start.statusCode).toBe(503);
    await bare.close();
  });
});
