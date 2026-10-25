import { MockPush } from "@voicedesk/adapters";
import { endpointHash } from "@voicedesk/core";
import { pushSubscriptions } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, ORIGIN, signUpVerified, type TestHarness } from "./harness";

const push = new MockPush();
let h: TestHarness;

beforeAll(async () => {
  h = await createHarness({ push });
});
afterAll(() => h.close());

const as = (cookie: string) => ({ cookie, origin: ORIGIN });
const sub = (id: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  keys: {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
});

describe("push notifications on a device", () => {
  it("subscribes this sign-in, sends a test, and stores the subscription encrypted", async () => {
    const me = await signUpVerified(h, "Pusher");
    const before = await h.app.inject({
      method: "GET",
      url: "/api/me/push",
      headers: as(me.cookie),
    });
    expect(before.json()).toMatchObject({ available: true, devices: 0, thisSession: false });

    const on = await h.app.inject({
      method: "POST",
      url: "/api/me/push",
      headers: {
        ...as(me.cookie),
        "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile",
      },
      payload: { subscription: sub("device-1") },
    });
    expect(on.statusCode).toBe(200);
    const status = await h.app.inject({
      method: "GET",
      url: "/api/me/push",
      headers: as(me.cookie),
    });
    expect(status.json()).toMatchObject({ devices: 1, thisSession: true });

    const [mine] = await h.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpointHash, endpointHash(sub("device-1").endpoint)));
    expect(mine?.deviceLabel).toMatch(/Android/);
    expect(mine?.subscription).not.toContain("fcm.googleapis.com");

    const test = await h.app.inject({
      method: "POST",
      url: "/api/me/push/test",
      headers: as(me.cookie),
    });
    expect(test.json()).toEqual({ sent: 1, removed: 0 });
    expect(push.sent.at(-1)).toMatchObject({
      endpoint: sub("device-1").endpoint,
      message: { path: "/today" },
    });
  });

  it("refuses endpoints that aren't a browser push service", async () => {
    const me = await signUpVerified(h, "Sneaky");
    const res = await h.app.inject({
      method: "POST",
      url: "/api/me/push",
      headers: as(me.cookie),
      payload: {
        subscription: { ...sub("x"), endpoint: "https://169.254.169.254/latest/meta-data" },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("signing out removes that device's subscription", async () => {
    const me = await signUpVerified(h, "Leaver");
    await h.app.inject({
      method: "POST",
      url: "/api/me/push",
      headers: as(me.cookie),
      payload: { subscription: sub("device-leaver") },
    });
    const signOut = await h.app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: as(me.cookie),
      payload: {},
    });
    expect(signOut.statusCode).toBe(200);
    // The subscription went with the session.
    const left = await h.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpointHash, endpointHash(sub("device-leaver").endpoint)));
    expect(left).toEqual([]);
  });

  it("expired subscriptions are removed when a push bounces", async () => {
    const me = await signUpVerified(h, "Expired");
    await h.app.inject({
      method: "POST",
      url: "/api/me/push",
      headers: as(me.cookie),
      payload: { subscription: sub("gone-device") },
    });
    const test = await h.app.inject({
      method: "POST",
      url: "/api/me/push/test",
      headers: as(me.cookie),
    });
    expect(test.json()).toEqual({ sent: 0, removed: 1 });
    const status = await h.app.inject({
      method: "GET",
      url: "/api/me/push",
      headers: as(me.cookie),
    });
    expect(status.json()).toMatchObject({ devices: 0 });
  });
});
