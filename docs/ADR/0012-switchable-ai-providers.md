# ADR 0012 — Switchable AI providers with priority fallback

- **Status:** Accepted (2026-10-17). Amends ADR 0009's model choice: models are now chosen at runtime.

## Context

The owner wants to choose from an admin screen which AI powers the app: Claude, DeepSeek (API key), or a model running on their own machine (Qwen3.6 35B-A3B via an OpenAI-compatible server). Any provider that is switched on should be used.

## Decision

- **Settings table:** `ai_providers` is platform-wide (no tenant id). It holds kind, URL, models per tier (live conversations / background work), options, an encrypted API key, enabled flag, priority and the last test result.
  - RLS: readable by the runtime role, writable only under audited `withPlatformAccess`.
  - The migration seeds Claude, DeepSeek and a Local model row, all off.
- **Routing:** `RoutedLlmProvider` (`@voicedesk/adapters`) implements `LlmProvider`. It calls enabled, ready providers in priority order and **falls back** to the next on error or refusal. It never falls back after text has streamed, because that would switch model mid-sentence; the engine's graceful fallback covers that case. Settings reload every 10 seconds and immediately after admin changes. Nothing enabled means unavailable, so profile generation is disabled and summaries are basic.
- **Adapter for non-Claude providers:** `OpenAiCompatibleProvider` (official `openai` SDK) covers DeepSeek, Ollama, LM Studio, llama.cpp and vLLM.
  - **Thinking:** control is per provider (DeepSeek `thinking`, others `reasoning_effort`). It's off for live turns by default.
  - **Structured output:** `json_schema`, or `json_object` with the schema in the prompt for DeepSeek.
  - **Leaked reasoning:** `<think>` text is stripped from replies and from the stream.
- **History across providers:** provider-native history is tagged (`{ provider, data }`) and replayed only to the same provider. Examples are Claude thinking blocks, and DeepSeek `reasoning_content`, which DeepSeek requires to be echoed back with tools. Other providers rebuild turns from the neutral blocks, so a conversation survives a fallback.
- **Secrets:** API keys are encrypted with AES-256-GCM (`SETTINGS_ENCRYPTION_KEY`), with the provider row bound as associated data. They're never returned to clients; the UI shows a hint like `sk-…abcd`. Claude can still use `ANTHROPIC_API_KEY` from `.env`.
- **Admin screen:** `/platform/ai` (platform owner only; everyone else gets 404). It offers on/off toggles, ordering, URL, models (with "Find models" from the server), key, advanced options, and "Test connection". The test sends a ~6k-token prompt plus a tool call and **warns when the server truncates the prompt** because its context window is too small.

## Consequences

- **Local models:** they need a context window of at least 16k tokens. Measured on this machine, Ollama's default of 4,096 silently cut our ~2.5k-token prompt (only 1,229 tokens were read), and `qwen3:8b` took 30–100 seconds per turn. Fine for experiments, not for phone calls.
- **DeepSeek** processes data in China. It must not be used with real customer data until a UK GDPR international transfer assessment is done; the UI says so.
- **Evals** run against whatever is switched on, so record which providers were active when comparing results.
