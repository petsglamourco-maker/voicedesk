# ADR 0025 — Departments, the phone menu and the missed-call receptionist

- **Status:** Accepted (2026-10-25)

## Context

The owner asked for two receptionist features:

1. **Missed calls.** When the business's own line isn't answered, the AI takes the call: it books, arranges a call back or takes a message. Optionally, VoiceDesk rings the team first, and the AI answers when nobody picks up.
2. **A department menu** for larger companies: "press 1 for Sales, 2 for Support…". Calls are categorised, and the same AI carries on with that department's focus.

**Owner decisions:**

- **Payments:** the business pastes its own secure payment link, so the money goes to them.
- **Departments:** each one can have VoiceDesk staff, a transfer number and an email, or any mix.
- **Set-up:** the business sets up the menu itself, and it can be off outside opening hours.

## Decision

### Departments (data)

- **`departments`** (tenant, forced RLS), one row per department:
  - key 1–9 and name, with optional spoken names per language;
  - the business's instructions for the assistant;
  - routing: `people_then_phone` / `people_only` / `phone_only` / `message_only`;
  - transfer number, checked like every destination (ADR 0022);
  - notify email;
  - payment link (https only);
  - ring-first and enabled flags.
- **`department_members`** (tenant, RLS): which staff belong to a department.
- **`department_moves`** (tenant, RLS, **append-only**): each choice or move, by keypad, speech, chat or the assistant.
- **`conversations.department_id`, `handoffs.department_id`:** foreign keys added in custom SQL, because the Drizzle schemas would otherwise import each other.
- **Plan feature:** a new `departments` feature (Growth, Pro, trial). Saving a menu without it answers 402.
- **API:** `PUT /departments` saves the whole menu at once (`agent:configure`, audited; whether payment links changed is in the audit metadata). Keys can be swapped: kept rows are parked on negative keys inside the transaction.
- **Settings:** `agent_settings.menu_enabled`, `menu_hours` (`always` / `open`) and `menu_on_chat`.

### The phone menu

- **Opening** (`openingGreeting`): the fixed greeting with the **AI disclosure always first**, then the missed-call line and the recording notice when they apply, then either the menu line (`menuLine`, six languages) or the usual question.
- **Keypad** (voice worker, `RoomEvent.DtmfReceived` from the caller's SIP participant only):
  - **1–9** picks the department deterministically, with no model call. A fixed sentence is spoken, and the choice is saved and noted in the history.
  - **0** becomes the caller's own request for a person (`generateReply` with a fixed phrase in their language), so it follows normal routing.
  - **\* or #** repeats the menu.
- **Speech:** the departments, with the business's instructions, are in the **stable part of the system prompt** (once per business, so the prompt cache still works). The current department is in each turn's engine note. The new `set_department` tool picks or changes it. `PROMPT_VERSION` is `2026-10-25.1`.
- **Silence:** the first quiet spell after an unanswered menu repeats it once, before the usual "are you still there?".
- **Chat:**
  - website chat shows department buttons, and a tap sends the key;
  - WhatsApp gets a numbered list;
  - a bare number after the menu picks the department without a model call.

### Routing ("who deals with it")

- **`request_human` follows the caller's department:**
  - `message_only` → take a message;
  - otherwise its transfer number (or the business's), and its people only when it has any (`peopleAvailable(only)`);
  - handoffs record the department.
- **VA console and ringing pushes:** `waitingHandoffs(db, tenant, userId)` and `planRingingPush` show a department's call only to its people. A department without people rings everyone who answers calls.
- **Staff alerts and call summary emails** also go to the department's people and its email, marked `[Department]`.
- **Ring the team first**, business-wide (`agent_settings.ring_first`, a VA-console plan feature) or per department:
  - The assistant says "Let me try the team for you"; without a menu this replaces the greeting's question, still after the disclosure.
  - The existing `HandoffController` rings the console and phones in `ringFirst` mode.
  - If nobody answers, the assistant offers a booking, a call back or a message (`ringFirstMissedPhrase`) and carries on.
  - It only starts when someone is available.

### Payment links

- **`send_payment_link` tool:** only when the conversation's department has a link. It confirms the number or email address and never takes card details (Deepgram already redacts card numbers).
- **Sending:** the link goes through a `payment.link` notification job. Texts go through `checkSend` like every text. The message is a fixed phrase in the customer's language. Audited (`conversation.payment_link_sent`).
- **Not built yet:** links for an exact amount (Stripe Connect) would come later.

### Missed-call receptionist

- **Business setting** "How calls reach VoiceDesk" (`agent_settings.call_entry`):
  - `direct`;
  - `backup`: the business's main line forwards here when nobody answers.
- **Forwarded-call detection:** each inbound trunk maps the `Diversion` and `X-Forwarded-From` SIP headers to attributes (`FORWARDING_HEADERS`), so forwarded calls are recognised per call. Existing numbers need `number:sync` to get the mapping.
- **Recording it:** `conversations.entry` is `direct`, `forwarded` or `backup`.
- **Missed-call opening:** after the disclosure: "The team couldn't get to the phone just now, but I can book you in, arrange a call back or take a message."
- **Shown in:** a "Missed by the team" badge on calls, a Today chip, a daily brief line, and the summary email headline.

## Alternatives

- **A separate IVR before the AI** (TwiML `<Gather>`): rejected. It works only for Twilio, adds a second system, and loses the "just say what you need" path. Keypad handling in the voice worker works for both carriers.
- **Dialling desk phones first from VoiceDesk:** not built. Carrier "forward when unanswered" already rings the desk phone first for free, and ringing VoiceDesk people uses the existing console.

## Consequences

- One AI conversation covers menu, categorisation, routing and booking. Calls, the inbox, alerts and summaries all carry the department.
- **Live tests:** call the number and press a key; let a forwarded call ring out; ask for a payment link (one real SMS, about 4p).
- The eval set gains a "payments" scenario (54 scenarios). It needs a paid run with the owner's OK.
