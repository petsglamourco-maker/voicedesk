import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/errors";
import { ElevenLabsTtsProvider } from "../src/speech/elevenlabs";

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(respond(url, init ?? {}));
  }) as typeof fetch;
  return { impl, calls };
}

describe("ElevenLabsTtsProvider", () => {
  it("synthesises with the voice, model and language", async () => {
    const { impl, calls } = fakeFetch(() => new Response(new Uint8Array([1, 2, 3])));
    const tts = new ElevenLabsTtsProvider({ apiKey: "k", fetch: impl });
    const out = await tts.synthesize("Hello", { voiceId: "v1", language: "en" });
    expect(out.mimeType).toBe("audio/mpeg");
    expect([...out.audio]).toEqual([1, 2, 3]);
    expect(calls[0]?.url).toContain("/v1/text-to-speech/v1?");
    expect((calls[0]?.init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      text: "Hello",
      model_id: "eleven_flash_v2_5",
      language_code: "en",
    });
  });

  it("maps voices", async () => {
    const { impl } = fakeFetch(() =>
      Response.json({ voices: [{ voice_id: "a", name: "Alice", labels: { gender: "female" } }] }),
    );
    const voices = await new ElevenLabsTtsProvider({ apiKey: "k", fetch: impl }).listVoices();
    expect(voices).toEqual([{ id: "a", name: "Alice", languages: [], gender: "female" }]);
  });

  it("raises ProviderError, retryable on 429", async () => {
    const { impl } = fakeFetch(() => new Response("slow down", { status: 429 }));
    const tts = new ElevenLabsTtsProvider({ apiKey: "k", fetch: impl });
    const err: unknown = await tts
      .synthesize("x", { voiceId: "v", language: "en" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retryable).toBe(true);
  });
});
