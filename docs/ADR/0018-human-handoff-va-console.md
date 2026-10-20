# ADR 0018 — Human handoff and the VA console

- **Status:** Accepted (2026-10-20)

## Context

Phase 5 lets people take over from the assistant on the phone:

- the platform owner's own VA team, working across several businesses;
- a business's own staff.

Before this, a caller who asked for a person was transferred by SIP REFER to a phone number. That costs per minute, carries no context, and needs a carrier trunk. The owner wants the cheapest option that still sounds good.

## Decision

### Who answers

- Rows in `va_assignments`, with `source`:
  - `platform` — assigned in Platform admin → VAs. This also creates a `staff` membership, so tenant access, RLS and permissions work unchanged. Removing the assignment removes that membership only if the assignment created it.
  - `business` — the "Answers calls" toggle on the Team page.
- **Presence:** `agent_presence` is per user, not tenant data: one status across all businesses. The console sends a heartbeat every 20 s, and 60 s without one counts as offline.

### Incoming handoff

1. **Routing:** `request_human` on a phone call asks `peopleAvailable()`. The voice worker passes this in, and it's backed by `availableAnswerers`. `handoffPlan` then picks one of:
   - the VA console, with the phone number as fallback;
   - the phone number;
   - nobody (the assistant takes a message).

   The business chooses the route: `people_then_phone` (default), `people_only` or `phone_only`.

2. **Ringing:** the voice worker's `HandoffController` (pure, tested with fake timers):
   - creates a `handoffs` row (tenant data, forced RLS) and publishes `handoff` on Redis `voicedesk:live`;
   - mutes the assistant (`bridge.humanActive`);
   - says a fixed "still connecting you" every 15 s;
   - falls back after the business's ring time (10–120 s, default 30).
3. **Answering:** `POST /api/tenants/:id/handoffs/:id/answer` is a conditional update (`waiting → answered`), so two people answering at once, or an answer racing the timeout, have exactly one winner. It returns:
   - a LiveKit token for that room only (identity `va-<userId>`);
   - the call so far: transcript, contact, records.
4. **The person joins the room:**
   - the assistant says "You're through to Sam now" (so the caller knows it's a person), then stays listen-only;
   - the session is pinned to the caller (`inputOptions.participantIdentity`), so the person never becomes "the user";
   - the caller's words are saved as transcript (`withPerson`);
   - the person's audio goes on the business side of the stereo recording.
5. **The person leaves:**
   - **hand back** (`returned`): the assistant resumes with the fixed "You're back with the AI assistant" (disclosure again);
   - **hang up** (`ended`): the API deletes the room;
   - **dropped** (closed tab): treated as a hand back, so the caller is never left alone.

### Outbound

- A person rings a customer from the console or a contact's Call button. The call shows the business's number as caller ID, via a LiveKit outbound trunk per business number (created on first use) through that number's carrier (`SIP_OUTBOUND_<CARRIER>_*`).
- **Checks:**
  - only people who answer for the business can dial;
  - 8am–9pm business-local time unless it's a callback the customer asked for;
  - contacts flagged "Don't phone" are refused;
  - rate-limited and audited.
- No assistant joins outbound calls yet, so they aren't recorded or transcribed. They're logged as `direction = outbound`.

## Consequences

- **Cost:** incoming handoffs cost nothing beyond Deepgram minutes while the person talks (speech-to-text keeps the transcript). Outbound calls cost per minute at the carrier and stay off until configured with the owner's approval.
- **Transcript gap:** what the person says isn't transcribed, only what the caller says. Their voice is in the recording when recording is on.
- **Context only:** when the person hands back, the assistant gets an engine note, not what was discussed.
- **Scaling:** presence and ringing assume one API process for the SSE fan-out, the same as the inbox (ADR 0016).
- **Warm transfer:** the brief's warm transfer is met by putting the context on screen before the person speaks, not by the assistant briefing them aloud.
