import { describe, expect, it, vi } from "vitest";
import { TurnstileHumanCheck } from "../src/human/turnstile";
import { MockHumanCheck } from "../src/mocks";

/** Contract for the public-page bot check (ADR 0022). */
describe("TurnstileHumanCheck", () => {
  const make = (fetchImpl: typeof fetch) =>
    new TurnstileHumanCheck({ siteKey: "site", secretKey: "secret", fetch: fetchImpl });

  it("posts secret, token and IP to siteverify and reads success", async () => {
    const fetchSpy = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ success: true, "error-codes": [] })),
    );
    expect(await make(fetchSpy).verify("tok", "203.0.113.9")).toBe("human");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(JSON.parse(init!.body as string)).toMatchObject({
      secret: "secret",
      response: "tok",
      remoteip: "203.0.113.9",
    });
  });

  it("says bot when Cloudflare rejects the token, or for empty and oversized tokens", async () => {
    const no = make(() => Promise.resolve(Response.json({ success: false })));
    expect(await no.verify("tok")).toBe("bot");
    expect(await no.verify("")).toBe("bot");
    expect(await no.verify("x".repeat(2049))).toBe("bot");
  });

  it("says unavailable when Cloudflare can't be reached", async () => {
    const down = make(() => Promise.reject(new TypeError("fetch failed")));
    expect(await down.verify("tok")).toBe("unavailable");
    const error = make(() => Promise.resolve(new Response("oops", { status: 500 })));
    expect(await error.verify("tok")).toBe("unavailable");
  });

  it.runIf(process.env.RUN_LIVE_TURNSTILE === "1")(
    "matches Cloudflare's test keys (free; network)",
    async () => {
      const pass = new TurnstileHumanCheck({
        siteKey: "1x00000000000000000000BB",
        secretKey: "1x0000000000000000000000000000000AA",
      });
      const fail = new TurnstileHumanCheck({
        siteKey: "2x00000000000000000000BB",
        secretKey: "2x0000000000000000000000000000000AA",
      });
      expect(await pass.verify("XXXX.DUMMY.TOKEN.XXXX")).toBe("human");
      expect(await fail.verify("XXXX.DUMMY.TOKEN.XXXX")).toBe("bot");
    },
  );
});

describe("MockHumanCheck", () => {
  it("behaves like the contract", async () => {
    const mock = new MockHumanCheck();
    expect(await mock.verify("human")).toBe("human");
    expect(await mock.verify("nope")).toBe("bot");
    expect(await mock.verify("down")).toBe("unavailable");
  });
});
