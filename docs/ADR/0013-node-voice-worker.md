# ADR 0013 — Voice worker in TypeScript on LiveKit Agents for Node

- **Status:** Accepted (2026-10-17). Supersedes [ADR 0008](0008-python-voice-worker.md).

## Context

Phase 2 adds real-time voice: streaming speech-to-text → conversation engine → text-to-speech,
with barge-in, end-of-turn detection, mid-call language switching, a fixed AI disclosure, and a
median voice-to-voice latency under 800 ms. ADR 0008 proposed a Python worker that would call
the TypeScript engine over an internal API, with the Node SDK as an option if it caught up.

In October 2026, LiveKit Agents for Node (`@livekit/agents` 1.9.x) has every part we need:
Deepgram and ElevenLabs plugins, Silero VAD, the multilingual end-of-turn model (runs locally,
including en/es/fr/de/zh/ar), interruption handling, metrics, and explicit agent dispatch.

## Decision

- `apps/voice-agent` is a Node worker on LiveKit Agents, connected to **LiveKit Cloud**
  (free tier while testing; self-hosting stays possible).
- The worker runs the **same engine** as the text console, **in the same process**:
  `EngineVoiceAgent` overrides `llmNode`, so each caller turn becomes one `runTurn` call, and
  its streamed text goes straight to TTS. Flows, tools, records, the AI-provider router
  (ADR 0012), prompts and evals are shared. There is no second implementation and no RPC hop.
  `AgentSession` gets a placeholder LLM because it only runs the pipeline when one is set.
- Turns are serialised, and `persistTurn` (`agent-brain`) saves them the same way for every
  channel. A turn the caller interrupts still completes and is saved, so a confirmed booking
  is not lost.
- **Preemptive generation is off:** turns can create bookings and tickets, so they never run
  on a partial transcript.
- **Dispatch is explicit:** the API creates the conversation, dispatches `voicedesk-agent`
  to room `vd-<conversationId>` with `{ tenantId, conversationId }` metadata, and gives the
  browser a 15-minute token for that room only.
- **Speech:** Deepgram Nova-3 streaming (`multi` for en/es/fr/de; `zh` and `ar` set
  explicitly, switched when the engine changes language), with card numbers redacted (`pci`).
  ElevenLabs Flash v2.5 uses one multilingual voice per persona, which a business can override.
- **Greeting:** the stored fixed greeting (AI disclosure, plus a recording notice when
  `recordCalls` is on) is spoken with `session.say` and can't be interrupted. It is never
  generated.
- **Latency:** end-of-utterance (LiveKit), engine first text (ours) and TTS first byte
  (LiveKit) are measured per turn, saved in message metadata and sent to the browser on the
  data topic `voicedesk.latency`.

## Consequences

- One language and toolchain. Voice behaviour is covered by the existing evals plus bridge tests.
- The engine's first-text time is the LLM's time to first token. If voice is slow, change the
  provider order in Platform admin (e.g. Claude Haiku first) rather than the code.
- Switching to Chinese or Arabic needs the engine to know first (`set_language`, or the
  business default), because `multi` recognition doesn't cover them. A caller who simply
  starts speaking Chinese on an English line may be misheard until the switch.
- Deepgram's Model Improvement Programme is left at its default for testing. Opting out
  (`mipOptOut`) costs more and is a decision to take, with the UK GDPR review, before real
  customer calls.
- Phase 2b adds SIP to the same worker. Each Twilio number gets its own LiveKit inbound trunk
  and dispatch rule (`individual`, room prefix `call-`), whose agent dispatch metadata is
  `{ tenantId, phoneNumberId }`. The browser path stays as the test console.
- Recordings are made in-process (caller track via rtc-node `AudioStream`; assistant audio
  via a pass-through `AudioOutput`), not with LiveKit Egress. That avoids Egress cost and an
  extra sub-processor, and the files go straight to our own storage. `record: false`
  stops LiveKit Cloud session reports.
