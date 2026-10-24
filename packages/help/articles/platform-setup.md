---
id: platform-setup
title: Platform admin - the Setup page
page: /platform/setup
roles: platform
keywords: setup, configuration, env, .env, environment, restart, ready, not set up, this computer only, features, smtp, sms, voice, livekit, deepgram, elevenlabs, google, microsoft, whatsapp, outbound
suggested: What does "This computer only" mean? | Where do I put the settings? | Which features cost money?
---

## What the Setup page shows

**Platform admin → Setup** shows what works on this VoiceDesk server today, and exactly what each feature still needs. Each feature has one of three states:

- **Ready**: set up and working.
- **This computer only**: works, but only on the computer running VoiceDesk (for example emails going to Mailpit instead of real inboxes).
- **Not set up**: needs settings before it works.

Each card also says whether the feature is **Free** or **Costs money to use**, and, if it isn't ready, **How to set it up**.

## Where settings go

Most settings go in the `.env` file in the VoiceDesk folder. After changing it:

1. Save the file.
2. Stop VoiceDesk and start it again, so every part picks up the new settings.
3. Reload the Setup page to check the state has changed.

Never paste keys or passwords into chats or help messages.

## The features

- **AI provider**: the assistant's brain for chat, calls, summaries and Ask VoiceDesk. Set up on **AI providers**, not in `.env`.
- **Voice**: speech recognition, natural voices and browser calls. Needs the LiveKit, Deepgram and ElevenLabs keys.
- **Phone calls**: needs SIP_AUTH_USERNAME and SIP_AUTH_PASSWORD, then a number under **Phone numbers**.
- **Real emails**: sign-up verification, invitations, call summaries, the daily brief and email replies. Until set up they appear in Mailpit (localhost:8025). Use an email-sending service (Brevo or Resend have free tiers, or Gmail with an app password) and set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and an EMAIL_FROM address you own.
- **Text messages**: confirmations, reminders and rating links. Set SMS_PROVIDER (twilio or telnyx), that carrier's API keys and SMS_FROM. Until then texts appear in Mailpit.
- **Google Calendar**: create an OAuth client in Google Cloud Console (console.cloud.google.com) with the redirect address shown on the page, then set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Publish the app to "In production"; apps left in Testing lose access after 7 days.
- **Outlook / Microsoft 365**: register an app in Microsoft Entra with the redirect address shown and a client secret, then set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.
- **Email inbox**: each business connects its own mailbox; the server only needs SETTINGS_ENCRYPTION_KEY.
- **WhatsApp**: a Meta developer app with the WhatsApp product, plus WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN. While VoiceDesk runs on this computer, run the tunnel so Meta can reach it.
- **Outbound calls**: a SIP trunk for outgoing calls (Twilio Elastic SIP Trunking or a Telnyx credentials connection) and its SIP_OUTBOUND_ login.
- **Public web address**: website chat on real websites, hosted forms and rating links. Needs VoiceDesk hosted on a server with your own domain.

## Ask before spending

Phone numbers, calls, texts, voice minutes and AI usage all cost money. Check before switching any of them on.
