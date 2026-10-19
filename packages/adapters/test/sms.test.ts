import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/errors";
import {
  FallbackSmsProvider,
  MailpitSmsProvider,
  TelnyxSmsProvider,
  TwilioSmsProvider,
} from "../src/messaging/sms";
import { smsFromEnv } from "../src/from-env";
import { MockEmailProvider } from "../src/mocks";

describe("MailpitSmsProvider", () => {
  it("delivers texts as emails for local testing", async () => {
    const email = new MockEmailProvider();
    const sms = new MailpitSmsProvider(email);
    await sms.send({ to: "+447700900123", from: "BrightDent", body: "Your check-up is booked." });
    expect(email.sent[0]).toMatchObject({
      to: "sms+447700900123@sms.local",
      text: "Your check-up is booked.",
    });
  });
});

describe("TwilioSmsProvider", () => {
  it("posts to the Messages API with basic auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: input instanceof Request ? input.url : input.toString(),
        init: init ?? {},
      });
      return Promise.resolve(Response.json({ sid: "SM123" }, { status: 201 }));
    }) as typeof fetch;
    const sms = new TwilioSmsProvider({ accountSid: "AC1", authToken: "tok", fetch: fetchImpl });
    const res = await sms.send({ to: "+447700900123", from: "+441234567890", body: "Hi" });
    expect(res.id).toBe("SM123");
    expect(calls[0]!.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("AC1:tok").toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.init.body as string))).toEqual({
      To: "+447700900123",
      From: "+441234567890",
      Body: "Hi",
    });
  });

  it("raises retryable errors on rate limits", async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response("slow", { status: 429 }))) as typeof fetch;
    const sms = new TwilioSmsProvider({ accountSid: "AC1", authToken: "tok", fetch: fetchImpl });
    const err: unknown = await sms
      .send({ to: "+44", from: "x", body: "y" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retryable).toBe(true);
  });
});

describe("TelnyxSmsProvider", () => {
  it("posts JSON to the v2 Messages API with a bearer key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: input instanceof Request ? input.url : input.toString(),
        init: init ?? {},
      });
      return Promise.resolve(Response.json({ data: { id: "msg-1" } }));
    }) as typeof fetch;
    const sms = new TelnyxSmsProvider({
      apiKey: "KEY1",
      messagingProfileId: "prof-1",
      fetch: fetchImpl,
    });
    const res = await sms.send({ to: "+447700900123", from: "BrightDent", body: "Hi" });
    expect(res.id).toBe("msg-1");
    expect(calls[0]!.url).toBe("https://api.telnyx.com/v2/messages");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer KEY1");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      to: "+447700900123",
      from: "BrightDent",
      text: "Hi",
      messaging_profile_id: "prof-1",
    });
  });

  it("raises non-retryable errors for rejected messages", async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        Response.json({ errors: [{ code: "40310", title: "Invalid to" }] }, { status: 422 }),
      )) as typeof fetch;
    const sms = new TelnyxSmsProvider({ apiKey: "k", fetch: fetchImpl });
    const err: unknown = await sms
      .send({ to: "+44", from: "x", body: "y" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retryable).toBe(false);
  });
});

describe("SMS provider order", () => {
  it("falls back to the next provider when one fails", async () => {
    const failing = {
      name: "down",
      send: () => Promise.reject(new ProviderError("down", "HTTP 500", { retryable: true })),
    };
    const email = new MockEmailProvider();
    const sms = new FallbackSmsProvider([failing, new MailpitSmsProvider(email)]);
    await sms.send({ to: "+447700900123", from: "X", body: "Hello" });
    expect(email.sent).toHaveLength(1);
    expect(sms.name).toBe("down>mailpit-sms");
  });

  it("reads the order from SMS_PROVIDER", async () => {
    const email = new MockEmailProvider();
    const chain = await smsFromEnv(email, {
      SMS_PROVIDER: "telnyx, twilio",
      TELNYX_API_KEY: "k",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "t",
    });
    expect(chain.name).toBe("telnyx-sms>twilio-sms");
    expect((await smsFromEnv(email, {})).name).toBe("mailpit-sms");
    await expect(smsFromEnv(email, { SMS_PROVIDER: "vonage" })).rejects.toThrow(/Unknown/);
  });
});
