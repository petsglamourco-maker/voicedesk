# ADR 0021 — In-app Help assistant and Contact support

- **Status:** Accepted (2026-10-24)

## Context

Users need answers about _using_ VoiceDesk: how to set something up, why something isn't working, and how to get more from it. "Ask VoiceDesk" (ADR 0020) answers questions about the business's _data_, not about the product. There was no end-user documentation. The owner asked for a support chatbot on every screen, with a way to reach a person.

## Decision

- **Knowledge: `packages/help`.**
  - About 36 Markdown articles written for owners, staff, VAs and the platform owner, versioned with the code. Each has tiny front-matter: id, title, page, roles, keywords, suggested questions.
  - Tests ensure:
    - every screen has an article;
    - every link points to a real route;
    - starter questions are well-formed.
  - **Rule:** when a feature changes, update its article.
- **Search: `HelpIndex`.**
  - Articles are split on `##` and embedded once in memory with the local embedding model (no DB table: the content is the same for everyone).
  - Results blend meaning (70%) and keyword overlap (30%), so exact terms like error codes are still found, and search still works without the model.
- **Engine: `agent-brain/src/help.ts` `askHelp`.**
  - A tool loop on the **realtime** tier: at most 4 rounds, 900 tokens, streamed. Tools:
    - `search_help`;
    - `get_my_setup`: yes/no facts only, via `apps/api/src/lib/help-setup.ts`, e.g. profile approved, calendar connected, numbers assigned, channels on, plus server readiness from `setupStatus`. Never customer data, names or keys;
    - `offer_support`.
  - The system prompt is stable and cacheable. Page and role go in a per-turn note.
  - Cost is recorded as purpose `help` against the business.
- **Without a business or AI provider:** "articles mode" (`helpFromSearch`) returns the best sections with links, at no AI cost.
- **API (`routes/help.ts`):**
  - `POST /api/help/ask` (SSE; membership is checked when a tenantId is sent, and non-members get 404; 20 per minute);
  - `GET /api/help/suggestions`;
  - `POST /api/help/support` (5 per hour);
  - platform-owner `GET/PATCH /api/platform/support-requests`.
  - Pages are stored with ids removed (`/t/:tenant/calls/:id`).
- **Contact support:** a `support_requests` table with forced RLS.
  - Anyone signed in can insert for themselves (no RETURNING).
  - Only `withPlatformAccess` (audited) can read, update or delete.
  - A `support.request` notification is planned in `notifications.ts`: every platform owner is emailed, with replies going to the asker.
  - The chat is included only if the person ticks the box.
- **UI:** `components/help/help-widget.tsx` is a floating orb on every signed-in screen (AppShell, StandaloneShell, onboarding). It opens with **?** or the palette.
  - Starter questions per screen, streamed answers rendered by a small safe Markdown renderer (in-app links only, no HTML), sources, thumbs, and a Contact support form.
  - The chat lives in sessionStorage.
  - Toasts are offset so they don't cover it.

## Alternatives

- **All articles in the system prompt:** simpler, but 30k+ tokens per question and it scales poorly. Rejected.
- **A platform knowledge table in Postgres:** unnecessary for content that ships with the code.
- **A third-party helpdesk widget (Intercom etc.):** costs money and sends user data out.

## Consequences

- **Cost:** about $0.0005 per question on DeepSeek. Free in articles mode.
- **Data:** questions go to the active AI provider. Users are told not to share customers' personal details. The DeepSeek caveat (ADR 0012) applies.
- **Upkeep:** help content must be kept current. The article test catches missing screens and dead links, but not wrong instructions.
