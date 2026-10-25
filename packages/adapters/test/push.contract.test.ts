import { describe, expect, it } from "vitest";
import { MockPush } from "../src/mocks";
import { isPushEndpoint } from "../src/push/types";
import { generatePushKeys, WebPushProvider } from "../src/push/web-push";

describe("push endpoints", () => {
  it("only the browsers' push services are allowed", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGz")).toBe(true);
    expect(isPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });
});

describe("web push provider", () => {
  it("makes VAPID keys and refuses non-push endpoints without a request", async () => {
    const keys = generatePushKeys();
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const provider = new WebPushProvider({ ...keys, subject: "mailto:test@example.com" });
    expect(provider.publicKey).toBe(keys.publicKey);
    const result = await provider.send(
      { endpoint: "https://127.0.0.1/push", keys: { p256dh: "x", auth: "y" } },
      { title: "t", body: "b", path: "/today" },
    );
    expect(result).toBe("gone");
  });

  it("the mock reports expired subscriptions", async () => {
    const mock = new MockPush();
    const sub = { endpoint: "https://fcm.googleapis.com/gone", keys: { p256dh: "x", auth: "y" } };
    expect(await mock.send(sub, { title: "t", body: "b", path: "/" })).toBe("gone");
  });
});
