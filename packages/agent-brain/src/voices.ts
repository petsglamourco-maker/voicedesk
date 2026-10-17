import type { PersonaId } from "./personas";

/**
 * Text-to-speech voices per persona (brief §3.3: same persona identity in every language).
 * ElevenLabs multilingual models speak all six languages with one voice, so each persona
 * keeps a single voice id; businesses can override it per persona in agent settings.
 */

/** Low-latency multilingual model (~75 ms to first audio). */
export const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";

/** ElevenLabs premade voices with British accents, matched to each persona's style. */
export const DEFAULT_VOICE_IDS: Record<PersonaId, string> = {
  amelia: "Xb7hH8MSUJpSbSDYk0k2", // "Alice": warm, clear, British female
  james: "JBFqnCBsd6RMkjVDRZzb", // "George": friendly, British male
  sofia: "pFZP5JQG7iQjIQuC4Bku", // "Lily": bright, British female
  daniel: "onwK4e9ZLuTAKqWW03F9", // "Daniel": calm, British male
};

export interface VoiceChoice {
  voiceId: string;
  model: string;
}

export function voiceFor(
  personaId: PersonaId,
  overrides: Record<string, string> = {},
  model: string = DEFAULT_TTS_MODEL,
): VoiceChoice {
  return { voiceId: overrides[personaId] || DEFAULT_VOICE_IDS[personaId], model };
}

/**
 * Deepgram Nova-3 language setting. "multi" code-switches between English, Spanish,
 * French and German; Chinese and Arabic need their own language code.
 */
export function sttLanguageFor(language: string): string {
  return language === "zh" || language === "ar" ? language : "multi";
}
