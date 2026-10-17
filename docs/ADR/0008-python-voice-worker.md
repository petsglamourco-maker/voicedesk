# ADR 0008 — Python voice worker on LiveKit Agents

- **Status:** Superseded by [ADR 0013](0013-node-voice-worker.md) (2026-10-17)

## Context

Real-time voice needs streaming STT → LLM → TTS, barge-in, semantic end-of-turn detection and SIP telephony, with a median voice-to-voice latency target under 800 ms.

## Proposal

- Build `apps/voice-agent` in Python with LiveKit Agents, connected to Twilio Elastic SIP trunking.
- Conversation logic (flows and state machines) lives in TypeScript `packages/agent-brain`. It's shared with the text agent and simulated-call harness, and the voice worker calls it over a small internal API, keeping one source of truth.
- Alternatively, if it reaches parity by then, use the LiveKit Agents Node SDK to stay all-TypeScript.

## To decide in Phase 2

- Python vs Node SDK: compare turn detection, plugin coverage and latency on the day.
- LiveKit Cloud (free tier) vs self-hosted LiveKit server.
- Where the brain runs: in-process (Node) or as an RPC hop (Python), and the latency cost of that hop.
