---
id: costs
title: What costs money in VoiceDesk
page: none
roles: owner, admin, platform
keywords: cost, costs, price, pricing, money, spend, charges, billing, ai cost, sms cost, phone minutes, whatsapp charges, free, expensive, budget
suggested: What does VoiceDesk cost to run? | How much does a text message cost? | Where can I see AI spending?
---

## The short version

Most of VoiceDesk is free to use. Costs come from the outside services it relies on: the AI model, phone calls, text messages and some WhatsApp messages. Anything that costs money is labelled in the app, for example "Calls cost money at your phone provider" or "texts cost money".

## AI replies

Every reply the assistant writes, every summary and every Ask VoiceDesk question uses the AI provider switched on for your account. Each reply typically costs a fraction of a cent.

- The [Test console](/t/:tenant/console) shows the response time and an estimated cost next to each reply.
- There's no spending report inside VoiceDesk yet. The platform owner sees the real total in the AI provider's own console.

## Phone calls

- A phone number has a monthly fee at the carrier (Twilio or Telnyx).
- Incoming calls are charged per minute by the carrier, plus per-minute charges for speech recognition and the assistant's voice.
- Transferred calls (putting callers through to a phone number) are charged per minute for the extra leg.
- If you forward your existing number to VoiceDesk, your own phone provider may charge for forwarded calls.

Answering handed-over calls in the VA console in your browser costs nothing extra.

## Outbound calls

Calls the assistant makes (callbacks and booking confirmations) and calls VAs dial from the console are charged per minute. They stay off until outbound calling is set up. You can limit them with **Most calls per day** on [Assistant](/t/:tenant/agent).

## Text messages

Booking confirmations, reminders, urgent alerts and rating links after calls are sent by text once a text-message service is connected. Each text costs about $0.05. To reduce texts:

- choose **No reminder** under **Appointment reminder**;
- leave **Also text callers a rating link after phone calls (texts cost money)** off.

## WhatsApp

Replies to customers within 24 hours of their last message are normally free. Messages your business starts after that window are charged by Meta.

## Free features

- Email: connecting your mailbox and email replies.
- Calendars: Google Calendar and Outlook.
- Website chat and forms.
- Knowledge, business profile, contacts, records and the Dashboard.
- The daily brief (it's built from your data, without AI).
- Ratings in website chat and WhatsApp.
