# ADR 0026 — Follow-ups after enquiries, and answers for unanswered questions

- **Status:** Accepted (2026-10-26)

## Context

Two features, approved by the owner:

1. **Follow-ups.** People enquire and leave without booking. One friendly follow-up the next morning, sent only with their agreement, turns some of them into bookings, and the business can see which.
2. **Questions to answer.** Unanswered questions were only listed in Records, and the owner had to write FAQs in the profile themselves. Now VoiceDesk groups them, drafts answers from the business's own documents, and approval takes one tap.

## Decision

### Follow-ups

- **Consent (PECR):** a follow-up is marketing.
  - It is only scheduled after the customer's explicit "yes" in the conversation: the `schedule_follow_up` tool needs `customerAgreed`, and the prompt says to offer once and only schedule after a clear yes.
  - It is one message, and the text says so.
  - The business switches it on (`agent_settings.follow_ups`, off by default). It's a plan feature (`follow_ups`: Growth, Pro, trial), checked when switched on (402), when scheduled and when sent.
- **Data:** `follow_ups` (tenant, RLS) holds one row per conversation (unique), with:
  - channel (`sms` / `email` / `whatsapp`) and destination;
  - name and a cleaned topic (≤ 60 characters; no links, digits or markup, since the topic is customer-influenced);
  - language and send time;
  - status (`scheduled` → `sending` → `sent` / `skipped`) and reason;
  - `booking_id`.
- **When it's sent:** 10:00 local on the next day the business is open (tomorrow when hours aren't known).
  - WhatsApp stays inside Meta's 24-hour window: it's sent at most 23 hours after scheduling, and skipped if the customer's last message is older than 24 hours.
  - WhatsApp is only allowed in WhatsApp conversations.
- **Sending:** the workers' 15-minute tick claims due rows with a conditional update, then `planFollowUp` decides.
  - **Skipped when:** switched off, not in the plan, the customer booked since (same contact, phone or email), or past the WhatsApp window.
  - **Message:** a fixed text in the customer's language: name, business, topic, the number to call, and "This is a one-off message".
  - **Delivery:** texts go through `checkSend`; email; WhatsApp through the Cloud API from the business's WhatsApp number.
- **Attribution:** `createBooking` credits a follow-up sent to the same contact, phone or email within 7 days (`creditFollowUp`, in the booking's transaction).
  - It shows on Today ("Follow-ups this month (N booked)") and on the call page.
- **Audit:** `conversation.follow_up_scheduled`, with the channel only.

### Questions to answer

- **Data:**
  - `gap_answers` (tenant, RLS) holds one row per group of the same question: an embedding (384-dimension local model), count, last asked, draft, sources, status, and who decided.
  - `knowledge_gaps.gap_answer_id` links each logged question to its group.
- **Sweep:** an AI-queue job `gaps.sweep` runs every 30 minutes (`processKnowledgeGaps`).
  - **Grouping (free, local embeddings):** each new open question joins the nearest pending group at cosine similarity ≥ 0.88, or starts one.
  - **Drafting:**
    - `searchKnowledge` finds the top passages (score ≥ 0.3);
    - one `realtime` call answers **only from those passages**, framed as untrusted blocks with a rule to ignore instructions inside them, or answers `NOT_FOUND`;
    - no passages or `NOT_FOUND` means no draft, and the owner writes the answer;
    - skipped while AI is paused (`aiPauseFor`); usage is recorded.
- **Approval (`knowledge:write`):**
  - **Approve:** a person approves, with edits if needed. `addApprovedFaq` adds the FAQ to the approved profile as a **new approved version**, so it's in the prompt straight away. An open draft gets the same FAQ and is renumbered to stay the newest, so half-finished edits are neither lost nor published. The group's questions are resolved. Audited as `profile.faq_approved`.
  - **Dismiss:** closes the group's questions too.
  - Drafts never reach the assistant without approval (ADR 0011 grounding).
- **Screens:**
  - **Knowledge page:** "Questions to answer" (Records' "Add the answer" links there).
  - **Today:** a "Questions to answer" chip.
  - **Daily brief:** on Mondays it lists the top 3.

## Consequences

- `PROMPT_VERSION` is `2026-10-26.1` (the follow-up rule appears only when the setting is on). The eval run needs the owner's OK.
- Inbound text replies aren't handled by VoiceDesk yet, so follow-up texts point to the phone number rather than "reply".
- **Live tests:**
  - turn follow-ups on, ask by phone without booking and agree; the text arrives the next morning (one real text, about 4p);
  - ask the assistant something not in the profile, wait for the sweep, and approve the draft.
