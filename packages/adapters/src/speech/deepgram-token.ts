import type { VoiceTypingGrant, VoiceTypingProvider } from "./types";

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
const LISTEN_URL = "wss://api.deepgram.com/v1/listen";

/**
 * Voice typing (ADR 0027): a 30-second Deepgram token so the browser can stream microphone
 * audio straight to Deepgram's live transcription without ever seeing our API key. The key
 * needs Deepgram's "Member" role to create tokens. The browser connects with the token as
 * the WebSocket subprotocol pair ["bearer", token].
 */
export class DeepgramVoiceTyping implements VoiceTypingProvider {
  readonly name = "deepgram";

  constructor(
    private readonly opts: { apiKey: string; timeoutMs?: number; fetch?: typeof fetch },
  ) {}

  async grant(language: string): Promise<VoiceTypingGrant> {
    const res = await (this.opts.fetch ?? fetch)(GRANT_URL, {
      method: "POST",
      headers: { Authorization: `Token ${this.opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 30 }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
    });
    if (!res.ok) throw new Error(`Deepgram token request failed (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Deepgram returned no token");
    const params = new URLSearchParams({
      model: "nova-3",
      language: deepgramLanguage(language),
      smart_format: "true",
      interim_results: "true",
      // Speech ends after a short pause; the browser also stops after 60 s at most.
      endpointing: "300",
      utterance_end_ms: "2000",
    });
    return {
      token: body.access_token,
      expiresIn: body.expires_in ?? 30,
      url: `${LISTEN_URL}?${params.toString()}`,
      protocol: "bearer",
    };
  }
}

/** Our six languages in Deepgram's codes (nova-3). */
export function deepgramLanguage(lang: string): string {
  return (
    ({ en: "en", es: "es", fr: "fr", de: "de", zh: "zh-CN", ar: "ar" } as Record<string, string>)[
      lang
    ] ?? "en"
  );
}
