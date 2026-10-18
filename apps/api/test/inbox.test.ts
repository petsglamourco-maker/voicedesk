import { MockLlmProvider } from "@voicedesk/adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { live, type LiveEvent } from "../src/lib/live";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let key: string;
let visitorId: string;
let threadId: string;
const llm = new MockLlmProvider();
const SHOP = "https://shop.example.com";

beforeAll(async () => {
  h = await createHarness({ llm });
  owner = await createOwnerWithTenant(h, "Inbox Co");
  const auth = { cookie: owner.cookie, origin: ORIGIN };
  key = (
    await h.app.inject({
      method: "GET",
      url: `/api/tenants/${owner.tenantId}/widget`,
      headers: auth,
    })
  ).json<{ key: string }>().key;
  await h.app.inject({
    method: "PUT",
    url: `/api/tenants/${owner.tenantId}/widget`,
    headers: auth,
    payload: {
      enabled: true,
      allowedOrigins: [SHOP],
      color: "#2563eb",
      title: "",
      position: "right",
    },
  });
  visitorId = (
    await h.app.inject({
      method: "POST",
      url: `/api/public/chat/${key}/session`,
      payload: { origin: SHOP },
    })
  ).json<{ visitorId: string }>().visitorId;
});
afterAll(() => h.close());

const auth = (cookie = owner.cookie) => ({ cookie, origin: ORIGIN });
const base = () => `/api/tenants/${owner.tenantId}/inbox`;
const chat = (text: string) =>
  h.app.inject({
    method: "POST",
    url: `/api/public/chat/${key}/messages`,
    payload: { visitorId, origin: SHOP, text, typedMs: 3000 },
  });

describe("unified inbox", () => {
  it("lists website chats with unread counts and opens a thread (marking it read)", async () => {
    llm.enqueue(MockLlmProvider.text("Hello! How can I help?"));
    await chat("Hi there");
    const list = await h.app.inject({
      method: "GET",
      url: `${base()}?filter=unread`,
      headers: auth(),
    });
    const body = list.json<{
      threads: Array<{ id: string; channel: string; unread: number }>;
      counts: { unread: number };
    }>();
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]).toMatchObject({ channel: "web_chat", unread: 1 });
    threadId = body.threads[0]!.id;

    const open = await h.app.inject({
      method: "GET",
      url: `${base()}/${threadId}`,
      headers: auth(),
    });
    expect(open.json<{ messages: Array<{ role: string }> }>().messages.map((m) => m.role)).toEqual([
      "agent",
      "caller",
      "agent",
    ]);
    const after = await h.app.inject({
      method: "GET",
      url: `${base()}?filter=unread`,
      headers: auth(),
    });
    expect(after.json<{ threads: unknown[] }>().threads).toHaveLength(0);
  });

  it("takes over: staff replies reach the widget live and the assistant stays quiet", async () => {
    const events: LiveEvent[] = [];
    const stop = live.subscribe(`thread:${threadId}`, (e) => events.push(e));
    const reply = await h.app.inject({
      method: "POST",
      url: `${base()}/${threadId}/reply`,
      headers: auth(),
      payload: { text: "Hi, Owner here. Let me help." },
    });
    expect(reply.json()).toEqual({ sent: true });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message",
        human: true,
        text: "Hi, Owner here. Let me help.",
      }),
    );

    const before = llm.requests.length;
    const res = await chat("Thanks, I need a booking");
    expect(res.body).toContain('"queued":true');
    expect(llm.requests.length).toBe(before);

    const resumed = await h.app.inject({
      method: "POST",
      url: `/api/public/chat/${key}/session`,
      payload: { origin: SHOP, visitorId },
    });
    const messages = resumed.json<{ messages: Array<{ text: string; authorName?: string }> }>()
      .messages;
    expect(messages.find((m) => m.text.startsWith("Hi, Owner here"))?.authorName).toBe("Owner");

    const back = await h.app.inject({
      method: "POST",
      url: `${base()}/${threadId}/handback`,
      headers: auth(),
    });
    expect(back.json()).toEqual({ mode: "ai" });
    llm.enqueue(MockLlmProvider.text("I can help with the booking."));
    const again = await chat("Still there?");
    expect(again.body).toContain("I can help with the booking.");
    // The assistant was told what the person said.
    expect(JSON.stringify(llm.requests.at(-1))).toContain("Owner here");
    stop();
  });

  it("is private to the business", async () => {
    const other = await createOwnerWithTenant(h, "Other Inbox Co");
    const res = await h.app.inject({
      method: "GET",
      url: `${base()}/${threadId}`,
      headers: auth(other.cookie),
    });
    expect(res.statusCode).toBe(404);
  });
});
