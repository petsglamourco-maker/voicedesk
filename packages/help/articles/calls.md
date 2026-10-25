---
id: calls
title: The Calls page - transcripts, recordings and response times
page: /t/:tenant/calls
roles: owner, admin, staff
keywords: calls, phone, call log, transcript, recording, summary, response time, latency, forward, divert, phone number, outbound, callback
suggested: How do I forward my existing number to the assistant? | Where can I listen to a call recording? | What is the response time?
---

## What the Calls page shows

[Calls](/t/:tenant/calls) lists every phone call your assistant has taken, newest first, with the caller, outcome, length and response time. Calls from the Test console are marked **Test**; real calls are marked **Live**. A caller who hides their number shows as **Withheld**. Calls with a recording are marked **Recorded**.

Click **Open** on a call to see its details.

## Your assistant's number

The **Your assistant's number** card shows the phone number customers can ring. If you see "No phone number yet", your VoiceDesk administrator still needs to assign one. Meanwhile you can test by voice in the [Test console](/t/:tenant/console).

## Keep your existing number by forwarding calls

Open **Keep your existing number: forward calls here** under your number. On most UK landlines and mobiles you dial a code from the phone you want to forward:

- **All calls**: a code starting `**21*`.
- **Only when you don't answer**: a code starting `**61*`.
- **Only when you're busy**: a code starting `**67*`.

The page shows the full codes with your number filled in. To cancel, dial ##21#, ##61# or ##67#. Codes vary by network and phone system, and your provider may charge for forwarded calls.

## Missed calls: the assistant as your backup receptionist

Use **Only when you don't answer** (`**61*`) to keep answering your own phone. When nobody picks up, the call comes to VoiceDesk, and callers hear that the team couldn't get to the phone (after the AI introduction). The assistant then books them in, arranges a call back or takes a message.

These calls show **Missed by the team** here, on Today and in the daily brief, and the summary email says so. VoiceDesk usually recognises forwarded calls automatically. To treat every call to your VoiceDesk number this way, choose **My main line forwards to VoiceDesk when nobody answers** in [Assistant settings](/t/:tenant/agent).

If you use a Twilio number with a TwiML Bin, add `?X-Forwarded-From={{ForwardedFrom}}` to the end of the SIP address in the Bin so forwarded calls are recognised.

You can filter calls by department when you use [departments and a phone menu](/t/:tenant/departments).

## Inside a call

Each call page shows:

- **Recording**, if call recording is on. The caller is on the left channel and the assistant on the right.
- **Transcript** of what the caller and the assistant said.
- **Summary**, written a few seconds after the call ends, with **Follow-up needed** when someone should act.
- **Put through to a person**, if the call was handed to someone at the VA console: who answered, how long the caller waited, and whether it was handed back.
- **Response time** for each reply.

## Response time

**Response time (last 7 days)** shows the **Median** and the **Slowest 10%**: the time from the end of the caller's speech to the assistant's first audio. The target is a median under 800 ms. If you have numbers with more than one phone carrier, **By carrier** compares them.

## Calls the assistant makes

If outbound calling is set up, **Calls the assistant makes** lists planned and finished callbacks and booking confirmations, with their status (for example "answered", "left a voicemail" or "no answer"). Owners, admins and staff can **Cancel** a planned call. These calls cost money at the phone provider.

## Recordings and privacy

Recording is switched on or off with **Record calls** on [Assistant](/t/:tenant/agent). When it's on, callers hear a short recording notice. Keep recordings only as long as you need them.
