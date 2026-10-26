# ADR 0027 — Voice typing in text fields

- **Status:** Accepted (2026-10-26)

## Context

The owner asked for a "speak instead of type" button in VoiceDesk's text fields, starting with Ask VoiceDesk, and for it to be an option that can be switched off. Calls already use Deepgram for speech-to-text, so using it here sends audio nowhere new, and it covers the same six languages.

## Decision

- **Flow (the key stays on the server):**
  1. The browser asks `POST /api/tenants/:tenantId/voice-typing/token` (`tenant:read`, 20 a minute).
  2. The API checks both settings and `aiPauseFor`, then calls Deepgram `POST /v1/auth/grant` with `ttl_seconds: 30`.
  3. It returns the token and a fixed `wss://api.deepgram.com/v1/listen` URL: `nova-3`, the person's language, `smart_format`, `interim_results`, `endpointing=300`, `utterance_end_ms=2000`.
  4. The browser opens the socket with the subprotocol `["bearer", token]` and streams MediaRecorder webm/opus in 250 ms chunks.
  5. Final words are inserted at the cursor. It stops on a tap, on `UtteranceEnd` (a pause), when the socket closes, or after 60 seconds.
- **Key:** grants need a Deepgram key with the **Member** role. `DEEPGRAM_TYPING_KEY` is used when set, otherwise `DEEPGRAM_API_KEY`. Without either, the microphone never shows.
- **Settings (both default on, either hides it):**
  - for the business: `agent_settings.voice_typing`, under Assistant settings → Workspace;
  - for each person: `user_settings.voice_typing` (per user, not tenant data), on the Account page (`GET`/`PUT /api/me/voice-typing`).
  - `/api/tenants/:id` returns `voiceTyping`, which the tenant layout passes to `VoiceTypingScope`.
- **Cost:** each token is recorded as one minute of nova-3 ($0.0077) in `llm_usage` (purpose `voice_typing`), so it counts in the AI allowance and stops when that's used up. It's on every plan.
- **Where:** Ask VoiceDesk, the Inbox reply box, the command palette search and the Questions to answer boxes (`MicButton` from `components/voice/voice-typing.tsx`). New fields only need a ref and `<MicButton target={ref} />`.
- **Privacy:** VoiceDesk stores no audio and no transcript, and never logs the words. CSP `connect-src` allows `wss://api.deepgram.com`.

## Consequences

- Tokens can't be reused after 30 seconds, but a socket opened with one stays open, so the browser's 60-second cap is what limits a session. The usage figure assumes that cap.
- If Deepgram ever refuses browser sockets, the fallback is to relay the audio through our API with the same token route and settings.
