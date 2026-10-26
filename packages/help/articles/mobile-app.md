---
id: mobile-app
title: VoiceDesk on your phone - install the app, Today, notifications
page: /t/:tenant/today
roles: all
keywords: phone, mobile, app, install, home screen, add to home screen, today, notifications, push, alerts, iphone, android, offline, tabs
suggested: How do I put VoiceDesk on my phone? | How do I get notifications? | What is the Today page?
---

## Today

[Today](/t/:tenant/today) shows what needs you today:

- today's bookings;
- chats waiting for a person;
- calls nobody answered;
- callbacks booked;
- new messages to return;
- follow-ups sent this month and how many booked;
- questions waiting for an answer.

Owners and admins also see how much of this month's allowance is used. Tap any item to open it.

On a phone, the tabs at the bottom take you to **Today**, the **Inbox** and **Calls**. **More** opens the full menu, including the VA console for answering handed-over calls.

## Install VoiceDesk on your phone

VoiceDesk works in your phone's browser, and you can add it to your home screen so it opens like an app:

- **Android (Chrome):** open VoiceDesk, tap the ⋮ menu, then **Add to Home screen** or **Install app**.
- **iPhone (Safari):** open VoiceDesk, tap **Share**, then **Add to Home Screen**.

The installed app opens on Today. If your phone loses its connection, VoiceDesk shows an offline page. Your assistant keeps answering customers in the meantime.

## Notifications

Open [Account](/t/:tenant/account) and choose **Turn on notifications** under **Notifications on this device**. You'll be notified when:

- a customer is waiting for a person;
- a call is ringing for you (if you answer calls);
- there's an urgent message or issue;
- the monthly allowance reaches 80% or runs out (owners and admins).

Use **Send a test** to check that notifications arrive.

Notifications never include customer names, numbers or what they said. Open VoiceDesk to see the details. Signing out of the device turns its notifications off.

On iPhone, add VoiceDesk to your Home Screen first, then open it from there to turn notifications on (iOS 16.4 or later).

## Testing on your phone before VoiceDesk is online

While VoiceDesk runs only on your computer, your phone can reach it over your home Wi-Fi. This is a one-time set-up on the computer that runs VoiceDesk:

1. Install mkcert (`winget install FiloSottile.mkcert`) and run `mkcert -install`.
2. Run `pnpm mobile:lan`. It prints an address such as `https://192.168.1.20:8443` and a line to add to `.env` (`EXTRA_WEB_ORIGINS=…`). Add it and restart VoiceDesk.
3. Copy mkcert's `rootCA.pem` (its folder is printed) to your phone and install it:
   - **Android:** Settings → Security → Install a certificate → CA certificate.
   - **iPhone:** open the file, install the profile, then turn it on in Settings → General → About → Certificate Trust Settings.
4. On the phone, connected to the same Wi-Fi, open the printed address.

The address only works on your home network while `pnpm mobile:lan` is running. Nothing is reachable from the internet.
