// v0 interfaces for non-real-time speech work (voice-note transcription, voice previews).
// Real-time call audio is handled inside the voice worker (Phase 2), which uses its own
// framework plugins configured from the same provider settings.

export interface TranscriptionResult {
  text: string;
  /** BCP 47 language detected by the provider. */
  language?: string;
  confidence?: number;
}

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(
    audio: Uint8Array,
    options: { mimeType: string; languageHint?: string },
  ): Promise<TranscriptionResult>;
}

export interface Voice {
  id: string;
  name: string;
  languages: string[];
  gender?: "female" | "male" | "neutral";
}

export interface TextToSpeechProvider {
  readonly name: string;
  listVoices(): Promise<Voice[]>;
  synthesize(
    text: string,
    options: { voiceId: string; language: string; speakingRate?: number },
  ): Promise<{ audio: Uint8Array; mimeType: string }>;
}
