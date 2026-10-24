import { user } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupStatus, type SetupItem } from "../src/lib/setup";
import { createHarness, ORIGIN, signUpVerified, type TestHarness } from "./harness";

const byId = (items: SetupItem[]) => Object.fromEntries(items.map((i) => [i.id, i]));

describe("setupStatus", () => {
  it("marks unset features off and lists the missing setting names", () => {
    const s = byId(setupStatus({}, { enabledReady: 0 }));
    expect(s.ai!.state).toBe("off");
    expect(s.googleCalendar).toMatchObject({
      state: "off",
      missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    });
    expect(s.voice!.missing).toContain("DEEPGRAM_API_KEY");
    // Email and SMS fall back to Mailpit; the public address to localhost.
    expect(s.email!.state).toBe("local");
    expect(s.sms!.state).toBe("local");
    expect(s.publicAddress!.state).toBe("local");
  });

  it("marks features ready once their settings are present", () => {
    const env = {
      LIVEKIT_URL: "wss://x.livekit.cloud",
      LIVEKIT_API_KEY: "k",
      LIVEKIT_API_SECRET: "s",
      DEEPGRAM_API_KEY: "d",
      ELEVENLABS_API_KEY: "e",
      SIP_AUTH_USERNAME: "u",
      SIP_AUTH_PASSWORD: "p",
      SMTP_HOST: "smtp-relay.brevo.com",
      SMTP_USER: "u",
      SMTP_PASSWORD: "p",
      EMAIL_FROM: "VoiceDesk <hi@example.com>",
      SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "t",
      SMS_FROM: "+441234567890",
      SIP_OUTBOUND_TELNYX_USERNAME: "u",
      SIP_OUTBOUND_TELNYX_PASSWORD: "p",
      WEB_ORIGIN: "https://app.voicedesk.example",
    };
    const s = byId(setupStatus(env, { enabledReady: 1 }));
    for (const id of ["ai", "voice", "phone", "email", "sms", "outbound", "publicAddress"])
      expect(s[id]!.state, id).toBe("ready");
  });

  it("asks for the carrier's keys and a sender when SMS is switched to a carrier", () => {
    const s = byId(setupStatus({ SMS_PROVIDER: "telnyx" }, { enabledReady: 0 }));
    expect(s.sms).toMatchObject({ state: "off", missing: ["TELNYX_API_KEY", "SMS_FROM"] });
  });
});

describe("GET /api/platform/setup", () => {
  let h: TestHarness;
  let owner: { email: string; cookie: string };
  let regular: { email: string; cookie: string };

  beforeAll(async () => {
    h = await createHarness();
    owner = await signUpVerified(h, "SetupOwner");
    regular = await signUpVerified(h, "SetupRegular");
    await h.db
      .update(user)
      .set({ isPlatformOwner: true, twoFactorEnabled: true })
      .where(eq(user.email, owner.email));
  });
  afterAll(() => h.close());

  it("is only for the platform owner and never returns setting values", async () => {
    const hidden = await h.app.inject({
      method: "GET",
      url: "/api/platform/setup",
      headers: { cookie: regular.cookie, origin: ORIGIN },
    });
    expect(hidden.statusCode).toBe(404);

    const res = await h.app.inject({
      method: "GET",
      url: "/api/platform/setup",
      headers: { cookie: owner.cookie, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: SetupItem[] }>();
    expect(body.items.map((i) => i.id)).toContain("whatsapp");
    for (const [name, value] of Object.entries(process.env)) {
      if (/KEY|SECRET|PASSWORD|TOKEN/.test(name) && value && value.length > 6)
        expect(res.payload).not.toContain(value);
    }
  });
});
