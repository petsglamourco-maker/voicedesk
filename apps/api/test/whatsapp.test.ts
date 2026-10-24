import { createHmac } from "node:crypto";
import { MockEmbeddingProvider, MockLlmProvider } from "@voicedesk/adapters";
import { handleInboundMessage } from "@voicedesk/agent-brain";
import { conversationMessages, withTenant } from "@voicedesk/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { whatsAppSender } from "../src/routes/whatsapp";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  signUpVerified,
  makePlatformOwner,
  type TestHarness,
} from "./harness";

const SECRET = "app-secret";
const VERIFY = "verify-me";
const PHONE_ID = `10${Date.now()}`;

let h: TestHarness;
let platform: { email: string; cookie: string };
let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;

beforeAll(async () => {
  h = await createHarness({
    whatsapp: { accessToken: "token", appSecret: SECRET, verifyToken: VERIFY },
  });
  platform = await signUpVerified(h, "Platform");
  await makePlatformOwner(h, platform);
  biz = await createOwnerWithTenant(h, "WhatsApp Co");
});
afterAll(() => h.close());

const as = (cookie: string) => ({ cookie, origin: ORIGIN });

function delivery(phoneNumberId: string, messageId: string) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: "447700900123", profile: { name: "Sam" } }],
              messages: [
                {
                  from: "447700900123",
                  id: messageId,
                  timestamp: "1792300000",
                  type: "text",
                  text: { body: "Hi!" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  return { body, signature };
}

describe("WhatsApp webhook", () => {
  it("answers Meta's verification handshake only with the right token", async () => {
    const ok = await h.app.inject({
      method: "GET",
      url: `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`,
    });
    expect(ok.body).toBe("12345");
    const bad = await h.app.inject({
      method: "GET",
      url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1",
    });
    expect(bad.statusCode).toBe(403);
  });

  it("connects a number in platform admin, then queues signed messages for that business", async () => {
    const added = await h.app.inject({
      method: "POST",
      url: "/api/platform/whatsapp-numbers",
      headers: as(platform.cookie),
      payload: {
        tenantId: biz.tenantId,
        phoneNumberId: PHONE_ID,
        displayNumber: "+44 7700 900999",
      },
    });
    expect(added.statusCode).toBe(201);

    const { body, signature } = delivery(PHONE_ID, "wamid.ONE");
    const res = await h.app.inject({
      method: "POST",
      url: "/api/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(h.jobs.channels).toContainEqual({
      kind: "whatsapp.inbound",
      tenantId: biz.tenantId,
      phoneNumberId: PHONE_ID,
      from: "+447700900123",
      profileName: "Sam",
      messageId: "wamid.ONE",
      text: "Hi!",
    });
  });

  it("rejects unsigned or tampered deliveries and ignores unknown numbers", async () => {
    const before = h.jobs.channels.length;
    const { body, signature } = delivery(PHONE_ID, "wamid.TWO");
    const tampered = await h.app.inject({
      method: "POST",
      url: "/api/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      payload: body.replace("Hi!", "Pay me"),
    });
    expect(tampered.statusCode).toBe(401);
    const unknown = delivery("99999999", "wamid.THREE");
    await h.app.inject({
      method: "POST",
      url: "/api/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": unknown.signature },
      payload: unknown.body,
    });
    expect(h.jobs.channels.length).toBe(before);
  });

  it("gives the business a click-to-chat link and QR code", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/whatsapp`,
      headers: as(biz.cookie),
    });
    const body = res.json<{ connected: boolean; link: string; qrSvg: string }>();
    expect(body).toMatchObject({ connected: true, link: "https://wa.me/447700900999" });
    expect(body.qrSvg).toMatch(/^<svg/);
  });
});

describe("WhatsApp staff replies", () => {
  it("send within 24 hours of the customer's last message, and refuse after", async () => {
    const result = await handleInboundMessage(
      { db: h.db, llm: new MockLlmProvider(), embeddings: new MockEmbeddingProvider() },
      {
        tenantId: biz.tenantId,
        channel: "whatsapp",
        externalId: "+447700900123",
        phone: "+447700900123",
      },
      "Hello",
    );
    const sent: string[] = [];
    const sender = whatsAppSender({ db: h.db }, (_id, to, text) =>
      Promise.resolve(void sent.push(`${to}|${text}`)),
    );
    const params = {
      tenantId: biz.tenantId,
      threadId: result.threadId,
      channel: "whatsapp" as const,
      externalId: "+447700900123",
      text: "Hi Sam",
      authorName: "Robin",
    };
    await sender.send(params);
    expect(sent).toEqual(["+447700900123|Robin: Hi Sam"]);

    await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .update(conversationMessages)
        .set({ createdAt: sql`now() - interval '25 hours'` })
        .where(eq(conversationMessages.conversationId, result.conversationId)),
    );
    await expect(sender.send(params)).rejects.toMatchObject({ code: "WHATSAPP_WINDOW_CLOSED" });
  });
});
