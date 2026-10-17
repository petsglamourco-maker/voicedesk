import { ProviderError } from "../errors";
import type { TextToSpeechProvider, Voice } from "./types";

/**
 * ElevenLabs text-to-speech over REST, for voice previews. Live calls stream through the
 * LiveKit ElevenLabs plugin in the voice worker instead.
 */
export class ElevenLabsTtsProvider implements TextToSpeechProvider {
  readonly name = "elevenlabs";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      apiKey: string;
      model?: string;
      baseUrl?: string;
      fetch?: typeof fetch;
    },
  ) {
    this.baseUrl = options.baseUrl ?? "https://api.elevenlabs.io";
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listVoices(): Promise<Voice[]> {
    const res = await this.request("/v1/voices", { method: "GET" });
    const body = (await res.json()) as {
      voices?: { voice_id: string; name: string; labels?: Record<string, string> }[];
    };
    return (body.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      // Multilingual models speak every supported language with any voice.
      languages: [],
      gender:
        v.labels?.gender === "female" || v.labels?.gender === "male" ? v.labels.gender : undefined,
    }));
  }

  async synthesize(
    text: string,
    options: { voiceId: string; language: string; speakingRate?: number },
  ): Promise<{ audio: Uint8Array; mimeType: string }> {
    const res = await this.request(
      `/v1/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: this.options.model ?? "eleven_flash_v2_5",
          language_code: options.language,
          ...(options.speakingRate ? { voice_settings: { speed: options.speakingRate } } : {}),
        }),
      },
    );
    return { audio: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/mpeg" };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), "xi-api-key": this.options.apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new ProviderError("elevenlabs", `HTTP ${res.status}: ${detail}`, {
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    return res;
  }
}
