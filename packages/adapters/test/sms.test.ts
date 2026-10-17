import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/errors";
import { MailpitSmsProvider, TwilioSmsProvider } from "../src/messaging/sms";
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
