---
id: troubleshoot-phone
title: Phone calls not ringing or not connecting
page: none
roles: owner, admin, va, platform
keywords: phone not ringing, calls not working, no answer, va console not ringing, microphone, no sound, twilio error, 32202, 32205, geo permissions, sip, not routed, transfer failed
suggested: Why isn't my number answering? | Why isn't the VA console ringing? | What do Twilio errors 32202 and 32205 mean?
---

## The assistant doesn't answer the number

1. Open [Calls](/t/:tenant/calls). Does **Your assistant's number** show the number? If it says "No phone number yet", your VoiceDesk administrator hasn't assigned one.
2. If you forward an existing number, check the forwarding code was accepted. Ring the VoiceDesk number directly to compare.
3. The platform owner checks **Platform admin → Phone numbers**: the number should be assigned to the right business and show **Routed**, not **Not routed** or **Off**.
4. The platform owner checks **Platform admin → Setup**: **Voice** and **Phone calls** must be **Ready**.

## The VA console doesn't ring

Calls only reach the VA console when all of these are true:

- you're set up to answer calls for that business (**Answers calls** on the Team page, or assigned as a VA);
- your **Status** is **Available**;
- the VA console tab is open (closing it or the laptop lid makes you offline within a minute);
- **Who callers reach** on [Assistant](/t/:tenant/agent) is not **Phone number only**;
- the caller asked for a person.

If you can see the call but hear no ringtone, choose **Available** again: browsers only play sound after a click.

## Can't hear or be heard

If the console says the browser isn't allowed to use your microphone, click the icon to the left of the web address, set Microphone to Allow, then hang up and try again. If it says no microphone was found, plug in a headset, then try again. Check your computer's sound output too.

## Twilio errors (for the platform owner)

In the Twilio console (console.twilio.com), open the call logs to see the error code.

- **32202 - bad SIP credentials**: the username and password in your TwiML Bin don't match SIP_AUTH_USERNAME and SIP_AUTH_PASSWORD in `.env`. Make them identical, restart VoiceDesk, and call again.
- **32205 - geo permissions**: Twilio is blocking calls to or from that country. In Twilio, open Voice geographic permissions and allow the country (for the UK, the Low Risk setting), then call again.

## Transfers to a phone number fail

Transfers need a SIP trunk with Call Transfer (SIP REFER) switched on; the simpler TwiML Bin setup can't transfer. Check the **Number to put callers through to** on [Assistant](/t/:tenant/agent) is correct. If a transfer fails, the assistant offers to take a message instead.

## Still stuck

Try a voice call in the [Test console](/t/:tenant/console) with **Talk by voice (microphone)**. If that works, the problem is with the phone line rather than the assistant.
