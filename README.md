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

## Take real phone calls (costs money: ask first)

1. **Twilio** (twilio.com): create an account, then **Elastic SIP Trunking → Trunks → Create**. Under **Origination**, add `sip:<your LiveKit SIP host>;transport=tcp`. The host is in LiveKit Cloud → Project settings ("SIP URI").
2. **Buy a UK number** in Twilio (Phone Numbers → Buy). UK numbers need an address bundle, which can take a few days to approve. Attach the number to the trunk.
3. In VoiceDesk: **Platform admin → Phone numbers** → add the number in international format (`+44…`) and pick the business. This creates the LiveKit routing.
4. Call the number. The call appears under **Calls** (transcript, summary, response time, and the recording if _Record calls_ is on). Owners and admins get a summary email within a minute (locally in Mailpit).

A business can keep its existing number by forwarding calls to the VoiceDesk number. The Calls page shows the UK forwarding codes.

## Checks

```bash
pnpm verify      # lint + typecheck + unit/integration tests (incl. tenant isolation)
pnpm test:e2e    # browser test: sign up → create business → invite staff → accept
```

The first e2e run needs a browser: `pnpm --filter @voicedesk/web exec playwright install chromium`.
