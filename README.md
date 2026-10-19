# VoiceDesk

A multi-tenant AI receptionist, customer support and virtual assistant platform for UK businesses (and beyond).

> Status: **Phase 1 — Knowledge & text agent** built (Phase 0 foundations complete). See [CLAUDE.md](CLAUDE.md) for architecture and conventions, and [docs/ADR](docs/ADR/README.md) for decisions.

## Run it locally (Windows)

**You'll need:** Node 24+, pnpm 12 (`corepack enable`), Docker Desktop and Git.

```bash
# 1. Configuration
cp .env.example .env
#    then edit .env and set BETTER_AUTH_SECRET (32+ random chars) and PLATFORM_OWNER_PASSWORD

# 2. Infrastructure: Postgres + pgvector, Valkey, SeaweedFS (S3), Mailpit
pnpm infra:up

# 3. Dependencies, database and demo data
pnpm install
pnpm db:migrate
pnpm db:seed

# 4. Run everything
pnpm dev
```

Then open:

- **App:** http://localhost:3000. Sign up, verify your email, create a business, and invite your team.
- **Email inbox (Mailpit):** http://localhost:8025. Every email the app sends lands here, nothing goes out.
- **API docs:** http://localhost:3000/api/docs

The seed creates a platform owner (`PLATFORM_OWNER_EMAIL` / `PLATFORM_OWNER_PASSWORD` from `.env`) with two demo businesses.

## Turn on the AI (optional, costs money)

The app works without an AI key: knowledge, the profile editor and the test console all run, but answers come from a mock. To use Claude:

1. In the [Anthropic Console](https://console.anthropic.com), set a monthly spend limit (we use $10 during development).
2. Add `ANTHROPIC_API_KEY=...` to `.env` and restart `pnpm dev`.
3. In the app: **Knowledge** → add your website, **Business profile** → _Generate from knowledge_ → check it → _Approve & publish_, then **Test console**.

`pnpm eval` runs 30 golden conversations (5 flows × 6 languages) against the AI providers switched on in Platform admin and prints the spend (about $0.06 on DeepSeek, more on Claude).

## Talk to the assistant by voice (optional, costs a few cents per test)

Browser voice runs through [LiveKit Cloud](https://cloud.livekit.io) (free tier), [Deepgram](https://console.deepgram.com) speech recognition ($200 free credit) and [ElevenLabs](https://elevenlabs.io) voices (pay as you go, about 1–2¢ per minute of speech).

1. Create the three accounts and copy the keys into `.env` (never into chat or git):
   - `LIVEKIT_URL` (`wss://<project>.livekit.cloud`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: LiveKit Cloud → Settings → Keys
   - `DEEPGRAM_API_KEY`
   - `ELEVENLABS_API_KEY`
2. Restart `pnpm dev`. The voice worker registers with LiveKit (health check: http://localhost:4200/).
3. **Test console** → Style: _Talk by voice (microphone)_ → _Start conversation_, then allow the microphone. You'll hear the greeting with the AI disclosure. You can interrupt, switch language ("can we speak Spanish?") and make a booking. The side panel shows how long each reply took.
4. **Assistant** → _Preview voice_ plays each persona's greeting. _Record calls_ adds a recording notice to the greeting.

## Connect Google Calendar (free)

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a project (e.g. "VoiceDesk dev").
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**: choose External, fill in the app name and your email, add the scopes `calendar.events`, `calendar.freebusy` and `calendar.calendarlist.readonly`, then **Publish app** (to "In production"). Apps left in "Testing" lose access after 7 days. Google will show an "unverified app" warning, which is fine for your own use.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type "Web application", authorised redirect URI `http://localhost:3000/api/integrations/google/callback`.
5. Put the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (never in chat), then restart `pnpm dev`.
6. In the app: **Integrations → Connect Google Calendar**, sign in, then choose the calendar bookings should go into.

## Connect Outlook / Microsoft 365 (free)

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com), then **App registrations → New registration**.
2. Name it "VoiceDesk dev". For supported account types, choose _Accounts in any organizational directory and personal Microsoft accounts_. Redirect URI: platform **Web**, `http://localhost:3000/api/integrations/microsoft/callback`.
3. **Certificates & secrets → New client secret**: copy the secret's **Value**.
4. **API permissions → Add → Microsoft Graph → Delegated**: add `Calendars.ReadWrite`, `User.Read`, `offline_access`, `openid` and `email`.
5. Put the Application (client) ID and the secret into `.env` as `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`, then restart `pnpm dev`.
6. In the app: **Integrations → Connect Outlook / Microsoft 365**, then choose the calendar.

A business connects one calendar at a time (Google or Microsoft).

## Take real phone calls (costs money: ask first)

1. **Twilio** (twilio.com): create an account, then **Elastic SIP Trunking → Trunks → Create**. Under **Origination**, add `sip:<your LiveKit SIP host>;transport=tcp`. The host is in LiveKit Cloud → Project settings ("SIP URI").
2. **Buy a UK number** in Twilio (Phone Numbers → Buy). UK numbers need an address bundle, which can take a few days to approve. Attach the number to the trunk.
3. In VoiceDesk: **Platform admin → Phone numbers** → add the number in international format (`+44…`) and pick the business. This creates the LiveKit routing.
4. Call the number. The call appears under **Calls** (transcript, summary, response time, and the recording if _Record calls_ is on). Owners and admins get a summary email within a minute (locally in Mailpit).

**Simpler alternative (no SIP trunk), used for the first live number:** put a username and long random password in `.env` as `SIP_AUTH_USERNAME` / `SIP_AUTH_PASSWORD`, run `pnpm --filter @voicedesk/api number:sync`, then in Twilio create a TwiML Bin (Develop → TwiML Bins) containing:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip username="YOUR_SIP_AUTH_USERNAME" password="YOUR_SIP_AUTH_PASSWORD">sip:+44XXXXXXXXXX@YOUR-LIVEKIT-SIP-HOST;transport=tcp</Sip>
  </Dial>
</Response>
```

Then set the number's voice configuration to that TwiML Bin (Phone Numbers → your number → Voice configuration → "A call comes in" → TwiML Bin). Transfers (SIP REFER) need the SIP-trunk method.

### Telnyx (alternative carrier)

Both carriers can run side by side: each number records its carrier, and **Calls** compares response times per carrier.

1. **Telnyx** (telnyx.com): create an account and add credit.
2. **Voice → SIP Trunking → create an FQDN connection**:
   - add your LiveKit SIP host (LiveKit Cloud → Project settings → SIP URI, without `sip:`), port 5060, transport **TCP**;
   - inbound number format **+E.164**;
   - inbound SIP region **Europe**.
3. **Numbers → buy a UK number.** Telnyx needs ID and a UK address in the number's area (a utility bill under 3 months old), and approval takes about 3 days. Then assign the number to the FQDN connection.
4. In VoiceDesk: **Platform admin → Phone numbers** → add the number with carrier **Telnyx**, or run `pnpm --filter @voicedesk/api number:add +44… <tenantId> "Main line" --telnyx`. Its LiveKit trunk only accepts calls from Telnyx's signalling servers (`TELNYX_SIP_ALLOWED_ADDRESSES` overrides the list).
5. Call it.

**Telnyx texts:** set `TELNYX_API_KEY` (plus `TELNYX_MESSAGING_PROFILE_ID` for a letters sender such as "BrightDent") and `SMS_PROVIDER=telnyx`. Use `telnyx,twilio` to fall back to Twilio. Real texts cost money, so ask first.

**Transfers with Telnyx:** not yet confirmed. Test SIP REFER on the FQDN connection before relying on it.

A business can keep its existing number by forwarding calls to the VoiceDesk number. The Calls page shows the UK forwarding codes.

**Putting callers through to a person:** in Twilio, open the trunk's **General** settings and enable **Call Transfer (SIP REFER)**, allowing transfers to the PSTN. Then set a transfer number under **Assistant → Putting callers through**. Twilio bills the transferred leg per minute.

## WhatsApp (free test number)

1. Go to [Meta for Developers](https://developers.facebook.com) → **My Apps → Create app** → type **Business**, then add the **WhatsApp** product. Meta gives you a free **test number**.
2. **WhatsApp → API setup**: add your own mobile under "To" as a test recipient, and note the **Phone number ID** and the temporary **access token**.
3. **App settings → Basic**: copy the **App secret**.
4. In `.env` (never in chat): `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, and a long random `WHATSAPP_VERIFY_TOKEN` you make up. Restart `pnpm dev`.
5. Install the tunnel tool once: `winget install --id Cloudflare.cloudflared`. Then run `pnpm tunnel` and copy the "WhatsApp callback URL" it prints. Only the webhook path is reachable through it.
6. Meta app → **WhatsApp → Configuration → Webhook**: paste the callback URL and your verify token, **Verify and save**, then subscribe to the **messages** field.
7. VoiceDesk **Platform admin → Phone numbers → WhatsApp numbers**: add the test number with its Phone number ID and pick the business.
8. Message the test number from your phone. The assistant replies, and the conversation appears in **Inbox**.

The quick-tunnel address changes each time `pnpm tunnel` starts, so update it in Meta when it does. Temporary access tokens expire after about a day; create a System User token for longer use.

## Answer a support mailbox (free)

1. For Gmail: turn on **2-Step Verification**, then go to **Google Account → Security → App passwords** and create one. Zoho, iCloud and Yahoo work the same way. Microsoft 365 isn't supported yet.
2. VoiceDesk → **Email**: choose the provider, enter the address and app password, then **Save and connect**. It logs in first to check the details.
3. Send an email to that address from another account. Within a minute it appears in **Inbox** with a draft reply. **Approve and send** (or edit first). The reply threads in the customer's mail app.
4. Once you trust it, switch on "send simple answers automatically". Complaints, cancellations and anything the assistant isn't sure about still wait for you.

Only mail that arrives after you connect is answered. Newsletters and automatic emails are ignored.

## Website forms (free)

- **Hosted form:** VoiceDesk → **Forms** → **Turn on**, then share the link (`/f/<key>`).
- **A form you already have** (Typeform, Jotform, Webflow, Tally…): set its webhook to your public address + the path shown on the Forms page. Locally, run `pnpm tunnel` and use the address it prints. Field names are detected automatically, or you can map them.

Each enquiry appears in **Inbox** with the assistant's triage and a draft reply. The reply is sent by email when the person gave an address.

## Checks

```bash
pnpm verify      # lint + typecheck + unit/integration tests (incl. tenant isolation)
pnpm test:e2e    # browser test: sign up → create business → invite staff → accept
```

The first e2e run needs a browser: `pnpm --filter @voicedesk/web exec playwright install chromium`.
