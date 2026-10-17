# Architecture Decision Records

One short file per significant decision. Statuses: Proposed → Accepted → Superseded (link the replacement).

| #                                          | Decision                                             | Status             |
| ------------------------------------------ | ---------------------------------------------------- | ------------------ |
| [0001](0001-monorepo-typescript.md)        | pnpm + Turborepo monorepo, strict TypeScript         | Accepted           |
| [0002](0002-local-first-hosting.md)        | Local-first development; UK hosting at launch        | Accepted           |
| [0003](0003-postgres-rls-tenancy.md)       | Postgres Row-Level Security for tenant isolation     | Accepted           |
| [0004](0004-better-auth.md)                | Better Auth (self-hosted) instead of Clerk           | Accepted           |
| [0005](0005-drizzle-orm.md)                | Drizzle ORM with hand-written SQL for RLS            | Accepted           |
| [0006](0006-fastify-api.md)                | Fastify API with Zod schemas and generated OpenAPI   | Accepted           |
| [0007](0007-provider-adapters.md)          | Provider adapters behind interfaces                  | Accepted           |
| [0008](0008-python-voice-worker.md)        | Python voice worker on LiveKit Agents                | Superseded by 0013 |
| [0009](0009-hybrid-conversation-engine.md) | Hybrid conversation engine (state machine + LLM)     | Accepted           |
| [0010](0010-local-embeddings.md)           | Local multilingual embeddings behind an adapter      | Accepted           |
| [0011](0011-approved-profile-grounding.md) | The approved business profile is the source of truth | Accepted           |
| [0012](0012-switchable-ai-providers.md)    | Switchable AI providers with priority fallback       | Accepted           |
| [0013](0013-node-voice-worker.md)          | Voice worker in TypeScript on LiveKit Agents (Node)  | Accepted           |
| [0014](0014-calendar-integrations.md)      | Calendar integrations (Google first, Outlook next)   | Accepted           |

Template: Context → Decision → Alternatives (optional) → Consequences.
