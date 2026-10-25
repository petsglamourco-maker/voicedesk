---
id: platform-phone-numbers
title: Platform admin - phone numbers and WhatsApp numbers
page: /platform/phone-numbers
roles: platform
keywords: phone numbers, twilio, telnyx, twiml bin, sip, sip trunk, elastic sip trunking, livekit, routing, routed, carrier, outbound, whatsapp numbers, phone number id
suggested: How do I connect a Twilio number? | What does "Not routed" mean? | How do I connect a WhatsApp number to a business?
---

## What this page does

**Platform admin → Phone numbers** lists the numbers you've bought at Twilio or Telnyx and the business each one rings. Calls are answered by that business's assistant. Adding a number here creates its call routing.

If you see "LiveKit isn't configured", add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to `.env` and restart.

## Twilio - incoming calls (TwiML Bin)

This is the simplest way and is how the first live number was set up.

1. In `.env`, set SIP_AUTH_USERNAME and a long random SIP_AUTH_PASSWORD, then restart. Twilio sends these with each call; calls without them are rejected.
2. In the Twilio console (console.twilio.com), buy a UK number. UK numbers need an address bundle, which can take a few days.
3. Go to TwiML Bins and create a bin that dials your number at your LiveKit SIP host (shown in LiveKit Cloud project settings) using that username and password. The README has the exact text.
4. In Phone Numbers, open your number, and under Voice set "A call comes in" to TwiML Bin, choosing your bin.
5. Back in VoiceDesk, fill in **Number (international format)** (for example +44 7700 900123), the **Business**, the **Carrier** and an optional **Label**, then click **Add number**.
6. Call the number.

## Twilio - transfers and outgoing calls (Elastic SIP Trunking)

Putting callers through to a phone number, the assistant's own calls and VAs dialling out need a Twilio Elastic SIP trunk:

- enable **Call Transfer (SIP REFER)** on the trunk, allowing transfers to ordinary phone numbers;
- add the trunk's outbound login to `.env` (the SIP_OUTBOUND_ settings) and restart.

Until then, outbound calling stays off.

## Telnyx (alternative carrier)

1. In Telnyx, under Voice, SIP Trunking, create an FQDN connection to your LiveKit SIP host, port 5060, TCP, number format +E.164, inbound region Europe.
2. Buy a UK number. Telnyx checks ID and a UK address first (about 3 days). Assign it to that connection.
3. Add it here with **Carrier** set to Telnyx. Its route only accepts calls from Telnyx's servers.

Both carriers can run side by side; the Calls page compares their response times.

## Managing numbers

Each number shows **Routed** or **Not routed**, and **Off** if switched off. You can change its business, **Switch off** / **Switch on**, or **Remove** it. Removing a number stops it being answered, but you must release it at the carrier separately.

## WhatsApp numbers

Further down, **WhatsApp numbers** connects a WhatsApp Business number from your Meta app (developers.facebook.com) to a business. Enter the **WhatsApp number**, its **Phone number ID** (from WhatsApp, API setup in your Meta app), choose the **Business** and click **Connect**. This needs WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN in `.env`.

## What costs money

- Phone numbers have a monthly fee at the carrier.
- Incoming calls, transfers and outgoing calls are charged per minute.
- Texts cost about $0.05 each.
- Voice services (speech recognition and voices) are charged per minute of calls.

Ask before buying a number or switching on outbound calling.
