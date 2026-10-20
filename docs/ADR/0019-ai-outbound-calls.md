# ADR 0019 — Calls the assistant places (callbacks and confirmations)

- **Status:** Accepted (2026-10-21)

## Context

Customers ask to be called back, and businesses want bookings confirmed. Phase 6 lets the assistant make those calls itself.

Outbound calls cost money (carrier minutes) and carry legal risk:

- UK PECR and Ofcom guidance on persistent misuse;
- calling people who said no;
- calling at night;
- the AI disclosure.

They must be safe by default and cheap to leave off.

## Decision

- **A list, then a dialler:**
  - `outbound_calls` (tenant data, forced RLS) holds what to call and why, with `not_before`, attempts and status.
  - Rows come from:
    - callback requests, when the business switches it on (via the staff alert of a ticket or message);
    - booking reminders, when "confirmation calls" is on (the call replaces the reminder text);
    - staff clicking **Assistant calls back** on a record, or approving it in "Ask VoiceDesk".
- **The API process dials:**
  - Every minute, per business (listed from the auth table, so there's no cross-tenant RLS read), it sweeps stale attempts and claims due rows (`scheduled → calling`, conditional update).
  - It then applies `decideOutboundCall` (pure, tested):
    - **cancel** when the contact said "Don't phone", the purpose is switched off, or the booking is gone;
    - **wait** outside 8am–9pm business-local time or over the daily cap (not counted as an attempt);
    - **call** otherwise.
  - Placing a call means: create the conversation (`direction = outbound`), dispatch the voice agent with `{ kind: "outbound", … }`, then `SipGateway.dial` from the business's number through its carrier's outbound trunk.
- **The voice worker's outbound mode:**
  - waits up to 50 s for the customer to answer;
  - `OutboundOpener` listens for 3 s;
  - a voicemail greeting (keyword list in 6 languages) gets a short fixed message with the business's number, then a hang-up;
  - otherwise a fixed opening says who's calling, **that it's an AI assistant**, and why.
  - The purpose goes to the engine as a note; the rest is a normal engine conversation (same tools, records, summary, recording rules, handoff to a person).
- **Retries:** at most 2 attempts, 2 h apart. Outcomes are `answered` / `voicemail` / `no_answer` / `cancelled` / `failed`, and attempts stuck in `calling` for 15 minutes count as unanswered.
- **Off by default:** both toggles start off, there's a daily cap (20), and nothing dials until `SIP_OUTBOUND_<CARRIER>_*` is set.

## Consequences

- **Single dialler:** one API process runs it today. With several processes, the conditional claim still prevents double calls, but each process would scan.
- **Voicemail detection is heuristic:** a machine that says none of the keywords is treated as a person and hears the opening.
- **No marketing calls:** the purposes are service calls only.
