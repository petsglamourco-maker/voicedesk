# ADR 0016 — Text channels, threads and human takeover

- **Status:** Accepted (2026-10-18)

## Context

Phase 4 puts the same assistant on website chat, WhatsApp, email and web forms. Staff need
one place to see every conversation and to step in. Each channel has its own identity for a
customer (a widget visitor id, a WhatsApp number, an email address and thread, a form
submission). The engine, tools, records and summaries already work per `conversations` row,
so they shouldn't be duplicated per channel.

## Decision

- **One conversation model.** Every channel writes ordinary `conversations` and
  `conversation_messages` rows. Records, summaries, contacts and evals work unchanged.
- **`channel_threads`** (tenant data, forced RLS) ties an outside identity
  (`channel`, `external_id`) to the currently open conversation. It also holds:
  - inbox state: `mode` (`ai` | `human`), `needs_human`, unread count, assignee, last preview;
  - `meta` for channel details, such as email threading headers or a form's consent.

  A new conversation starts after 24 hours of quiet, or after the previous one ended, so
  each gets its own summary.

- **One inbound pipeline:** `handleInboundMessage` in `agent-brain`:
  1. open the thread;
  2. in `ai` mode, run `runTurn` and save the turn with `persistTurn`;
  3. in `human` mode, store the message and don't reply.

  The first reply of each new conversation carries the fixed AI disclosure greeting. Website
  chat runs it inline (SSE). WhatsApp, email and forms run it in the workers (`channels`
  queue), so webhooks answer at once and retries are safe.

- **Public endpoints** (widget key, form key, WhatsApp phone-number id) live in
  `public_endpoints`. Unauthenticated routes resolve them through a SECURITY function
  (`app_resolve_public_endpoint`), which sees exactly one row and then hands over to
  `withTenant`.
- **Takeover.**
  - **Take over:** sets `mode = human` and assigns the thread to that staff member. A staff
    reply takes over automatically.
  - **Hand back:** returns the thread to the assistant, which gets an engine note saying a
    person handled it.
  - Staff replies are labelled with the person's first name. They go out through a
    per-channel `ChannelSender`: the widget live, the WhatsApp Cloud API, or SMTP in-thread.
- **Live updates.** An in-process hub in the API pushes SSE to the inbox and the widget. The
  workers publish on Redis `voicedesk:live`, which the API bridges into the same hub.

## Consequences

- One API process holds each widget's SSE connection. Running several API instances needs the
  Redis bridge for widget events too (it already exists for the inbox).
- Calls stay in the Calls log rather than the inbox. Voice is synchronous, so takeover means
  a transfer (ADR 0015), not a typed reply.
- While a person has a thread, nothing automated is sent on it.
