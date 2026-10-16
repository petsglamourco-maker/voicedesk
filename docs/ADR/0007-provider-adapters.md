# ADR 0007 — Provider adapters behind interfaces

- **Status:** Accepted (2026-10-16)

## Decision

Every external service is accessed through an interface in `@voicedesk/adapters`:

- telephony, SMS, WhatsApp
- speech-to-text (STT) and text-to-speech (TTS)
- LLM, calendar, email, object storage

**Implementations:**

- Each interface has an in-memory mock, used in tests and the simulated-call harness.
- Real implementations are added in the phase that needs them, after checking the provider's current docs and pinning versions. So far:
  - SMTP email (Mailpit locally; any SMTP relay later)
  - S3 storage (SeaweedFS locally; AWS S3 or R2 later)

**LLM interface:** exposes logical **model tiers** (`realtime`, `reasoning`) instead of model ids. Concrete model strings live in config.

**Storage keys:** must use `tenantKey(tenantId, ...)` (`tenants/<id>/...`), so a tenant's objects can be isolated and erased by prefix.

**Errors:** adapters throw `ProviderError` with a `retryable` flag. Business logic only handles that type.

## Consequences

- Contract tests (`packages/adapters/test/*.contract.test.ts`) run the same suite against the mock and the real implementation.
- The Phase 0 interfaces for telephony, messaging, speech, LLM and calendar are v0. They will be refined against real provider APIs.
