# ADR 0009 — Hybrid conversation engine (state machine + LLM)

- **Status:** Accepted (2026-10-17)

## Context

The brief requires flows with guaranteed steps: a complaint must capture specific details, confirm the callback number and give a reference. It also requires natural, multilingual conversation. A pure prompt can't guarantee steps, and a rigid script sounds robotic and breaks across six languages.

## Decision

`packages/agent-brain` runs each turn as `runTurn(state, callerText) → (newState, reply)`. The engine is pure (state in, state out) and shared by the text console, the eval harness and, later, the voice worker.

**The LLM's job:** language, phrasing and deciding what to ask next. It records information through tools:

- `update_complaint`, `update_booking`, `update_message`
- `check_availability`, `search_knowledge`, `set_intent`, `set_language`

**The state machine's job:** guaranteeing the required steps.

- Completion tools (`create_ticket`, `create_booking`, `take_message`) **refuse** until every required slot is filled, the phone number has been read back and confirmed, and the caller has confirmed the summary. The refusal lists what's missing.
- Each caller turn appends an `[Engine note]` mid-conversation system message with the current step and missing items. The history is append-only, which keeps the prompt cache valid.

**Deterministic parts, which never depend on the LLM:**

- the greeting with AI disclosure;
- the life-threatening emergency answer;
- the "technical problem, can I take a message" fallback;
- availability calculation and double-booking checks;
- reference numbers.

**Models:**

- `claude-haiku-5-5` for live turns, at effort `low`, streaming.
- `claude-sonnet-5-5` for profile extraction, summaries and the eval judge.
- Both are configured as model tiers (`LLM_MODEL_REALTIME` / `LLM_MODEL_REASONING`), never hard-coded.

**Prompt management:** the prompt is versioned (`PROMPT_VERSION`). The golden-conversation evals (`pnpm eval`) run on every prompt change.

## Consequences

- Flow guarantees are unit-tested with a scripted mock LLM at no cost. Conversation quality is measured by evals with a real model.
- Every side effect goes through the `AgentServices` interface, so voice (Phase 2) and other channels (Phase 4) reuse the same engine.
