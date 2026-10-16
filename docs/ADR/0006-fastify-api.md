# ADR 0006 — Fastify API with Zod schemas and generated OpenAPI

- **Status:** Accepted (2026-10-16)

## Decision

- Fastify 5 for the API and webhooks.
- Request and response schemas in Zod 4 via `fastify-type-provider-zod`. The OpenAPI document is generated from those schemas and served at `/api/docs`.
- Rate limiting: `@fastify/rate-limit`, with a tighter limit on `/api/auth/*`.
- The web app proxies `/api/*` to the API. In production a single domain does the same, so auth cookies are first-party and no CORS is needed.
- Webhook routes must verify signatures before parsing. A helper is in `apps/api/src/lib/webhooks.ts`.
- Request logs never include query strings (tokens) or personal data. A pino redaction list lives in `@voicedesk/compliance/logger`.

## Why not NestJS

Less ceremony for a two-person team, faster, and the domain logic lives in framework-free packages (`@voicedesk/core`) anyway.
