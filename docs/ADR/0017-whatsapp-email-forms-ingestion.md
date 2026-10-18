# ADR 0017 — WhatsApp, email and form ingestion

- **Status:** Accepted (2026-10-18)

## Context

Businesses already receive enquiries on WhatsApp, in a support mailbox and through website
forms. The owner chose the cheapest options that run on a local machine (ADR 0002):

- Meta's WhatsApp Cloud API directly (no reseller);
- the business's existing mailbox over IMAP/SMTP with an app password;
- a free Cloudflare quick tunnel for webhooks during development.

## Decision

### WhatsApp (Cloud API v25.0)

- Adapter `WhatsAppCloudProvider`: send text, mark as read, and parse webhooks.
  `/api/webhooks/whatsapp` handles the verify handshake and checks `X-Hub-Signature-256`
  (HMAC-SHA256 of the raw body, with the app secret). It queues each message with
  `jobId wa-<message id>`, so Meta's duplicate deliveries are dropped, and returns 200 at once.
- Numbers are registered per business in Platform admin (`public_endpoints` kind `whatsapp`,
  key = phone-number id). Credentials are platform-level in `.env`.
- Only free-form replies inside the 24-hour customer-service window. Paid template messages
  aren't used.

### Email (connected mailbox)

- One mailbox per business (`mailboxes`, forced RLS). The app password is encrypted with
  `SecretBox` (context `mailboxes:<tenant>`). Saving logs in to IMAP and SMTP first.
- The workers poll each mailbox every minute with a BullMQ job scheduler (`mailbox-<id>`):
  - **What's fetched:** imapflow, UID-based, with the UIDVALIDITY reset handled. On first
    connect the poller skips the backlog and only answers mail that arrives afterwards.
    Overlapping polls of one mailbox are skipped.
  - **Parsing:** mailparser. Quoted history is stripped, and attachments are listed by name
    and never opened.
  - **Ignored:** automated mail (Auto-Submitted, Precedence bulk/list, List-Id,
    List-Unsubscribe, no-reply senders).
- **Threads:** one per sender and root Message-ID. Replies set `In-Reply-To` and `References`.
- **Triage:** the same engine runs with an email style. The reply is always saved as a
  **draft** first:
  - **Default (always ask):** the draft waits in the inbox for Approve (optionally edited) and
    send.
  - **Auto-send:** sends straight away only when nothing sensitive happened. Sensitive means:
    no ticket, hand-off, cancellation or reschedule; not a complaint flow; and the assistant
    didn't note an unanswered question or ask for a person.
  - **Signatures:** the AI's emails are signed with the persona and "AI assistant, <business>"
    (disclosure). Staff replies are signed with their name.
- Microsoft 365 needs OAuth for IMAP. That's a follow-up reusing the Phase 3 Microsoft app.

### Forms

- **Hosted form** `/f/<key>` (public page in `apps/web`). It needs a ticked consent box and
  has an optional marketing box (stored as `contacts.marketing_consent`, opt-in only).
  Anti-spam checks:
  - Origin must be our own site;
  - a honeypot field and a minimum fill time (failed bot submissions are silently accepted
    and dropped);
  - a rate limit per IP.
- **Webhook** `/api/webhooks/forms/<key>` for existing forms (JSON or form-encoded). It needs
  a per-business secret (`?secret=` or `X-VoiceDesk-Secret`). Fields are mapped by
  configuration or detected from common names; other fields go to the assistant as details.
- **Each submission:** becomes a contact (matched by email or phone) and a `web_form` thread.
  The assistant triages it like an email and drafts a reply. Replies go by email only when
  the person gave an address and consent.

### Development tunnel

- `pnpm tunnel` starts a gateway that forwards **only** `/api/webhooks/*`, then a Cloudflare
  quick tunnel to it. The rest of the app is never reachable from the internet. The address
  changes on every start.

## Consequences

- Email content is untrusted: it reaches the model as data, under the existing
  prompt-injection rules. Bodies are never logged.
- Polling means up to a minute's delay. IMAP IDLE could replace it later without changing
  the pipeline.
- A crash mid-poll can triage a message twice. The read position is saved after each message,
  which keeps the window to one message.
