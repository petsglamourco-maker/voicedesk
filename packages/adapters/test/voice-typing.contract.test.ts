import { describe, expect, it } from "vitest";
import { MockVoiceTyping } from "../src/mocks";
import { DeepgramVoiceTyping, deepgramLanguage } from "../src/speech/deepgram-token";
import type { VoiceTypingProvider } from "../src/speech/types";

describe("Deepgram voice typing tokens", () => {
  it("asks for a 30-second token with our key, and returns only the token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "jwt-abc", expires_in: 30 }), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;
    const provider = new DeepgramVoiceTyping({ apiKey: "dg_secret_key", fetch: fakeFetch });
    const grant = await provider.grant("es");
    expect(calls[0]!.url).toBe("https://api.deepgram.com/v1/auth/grant");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
      "Token dg_secret_key",
    );
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ ttl_seconds: 30 });
    expect(grant).toMatchObject({ token: "jwt-abc", expiresIn: 30, protocol: "bearer" });
    expect(grant.url).toMatch(/^wss:\/\/api\.deepgram\.com\/v1\/listen\?/);
    expect(grant.url).toContain("model=nova-3");
    expect(grant.url).toContain("language=es");
    expect(JSON.stringify(grant)).not.toContain("dg_secret_key");
  });

  it("fails clearly when Deepgram refuses (e.g. a key without the Member role)", async () => {
    const fakeFetch = (() =>
      Promise.resolve(new Response("{}", { status: 403 }))) as unknown as typeof fetch;
    const provider = new DeepgramVoiceTyping({ apiKey: "k", fetch: fakeFetch });
    await expect(provider.grant("en")).rejects.toThrow(/403/);
  });

  it("maps our languages to Deepgram's", () => {
    expect(deepgramLanguage("zh")).toBe("zh-CN");
    expect(deepgramLanguage("ar")).toBe("ar");
    expect(deepgramLanguage("xx")).toBe("en");
  });
});

describe("mock voice typing follows the same contract", () => {
  const providers: VoiceTypingProvider[] = [new MockVoiceTyping()];
  for (const provider of providers) {
    it(`${provider.name}: returns a token, a wss URL and the bearer scheme`, async () => {
      const grant = await provider.grant("fr");
      expect(grant.token.length).toBeGreaterThan(0);
      expect(grant.url).toMatch(/^wss:\/\//);
      expect(grant.protocol).toBe("bearer");
    });
  }
});
