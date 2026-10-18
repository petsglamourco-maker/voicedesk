import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/errors";
import { parseWhatsAppWebhook, WhatsAppCloudProvider } from "../src/messaging/whatsapp-cloud";

function fakeGraph(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init: init ?? {} });
    return Promise.resolve(
      status === 200
        ? Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.1" }] })
        : new Response("rate limited", { status }),
    );
  }) as typeof fetch;
  return { impl, calls };
}

describe("WhatsAppCloudProvider", () => {
  it("sends a text message from the business number", async () => {
    const graph = fakeGraph();
    const wa = new WhatsAppCloudProvider({ accessToken: "tok", fetch: graph.impl });
    const res = await wa.sendText("1065", { to: "+447700900123", text: "Hello" });
    expect(res.id).toBe("wamid.1");
    expect(graph.calls[0]!.url).toBe("https://graph.facebook.com/v25.0/1065/messages");
    expect((graph.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      "Bearer tok",
    );
    expect(JSON.parse(graph.calls[0]!.init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+447700900123",
      type: "text",
      text: { preview_url: false, body: "Hello" },
    });
  });

  it("marks messages read and surfaces retryable errors", async () => {
    const graph = fakeGraph();
    await new WhatsAppCloudProvider({ accessToken: "t", fetch: graph.impl }).markRead(
      "1065",
      "wamid.9",
    );
    expect(JSON.parse(graph.calls[0]!.init.body as string)).toMatchObject({
      status: "read",
      message_id: "wamid.9",
    });
    const failing = new WhatsAppCloudProvider({ accessToken: "t", fetch: fakeGraph(429).impl });
    const err: unknown = await failing
      .sendText("1065", { to: "+44", text: "x" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retryable).toBe(true);
  });
});

describe("parseWhatsAppWebhook", () => {
  it("extracts customer messages and ignores status updates", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "1065" },
                contacts: [{ wa_id: "447700900123", profile: { name: "Sam" } }],
                messages: [
                  {
                    from: "447700900123",
                    id: "wamid.A",
                    timestamp: "1792300000",
                    type: "text",
                    text: { body: "Hi there" },
                  },
                  { from: "447700900123", id: "wamid.B", timestamp: "1792300001", type: "image" },
                ],
              },
            },
            {
              field: "messages",
              value: { metadata: { phone_number_id: "1065" }, statuses: [{ id: "x" }] },
            },
          ],
        },
      ],
    };
    expect(parseWhatsAppWebhook(payload)).toEqual([
      {
        phoneNumberId: "1065",
        from: "+447700900123",
        profileName: "Sam",
        messageId: "wamid.A",
        timestamp: new Date(1792300000 * 1000),
        text: "Hi there",
      },
      expect.objectContaining({ messageId: "wamid.B", text: "[image]" }),
    ]);
    expect(parseWhatsAppWebhook({ object: "page" })).toEqual([]);
  });
});
