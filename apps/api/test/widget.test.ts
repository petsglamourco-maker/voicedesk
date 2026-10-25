import { MockLlmProvider } from "@voicedesk/adapters";
import { channelThreads, conversations, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  widgetToken,
  type TestHarness,
} from "./harness";

let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let key: string;
const llm = new MockLlmProvider();
const SHOP = "https://shop.example.com";

beforeAll(async () => {
  h = await createHarness({ llm });
  owner = await createOwnerWithTenant(h, "Widget Co");
});
afterAll(() => h.close());

const auth = () => ({ cookie: owner.cookie, origin: ORIGIN });

function parseSse(payload: string) {
  return payload
    .split("\n\n")
    .filter((b) => b.trim())
    .map((b) => ({
      event: /^event: (.+)$/m.exec(b)?.[1],
      data: JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? "null") as Record<string, unknown>,
    }));
}

describe("website chat settings", () => {
  it("creates a key (off by default) and saves allowed websites as origins", async () => {
    const get = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${owner.tenantId}/widget`,
      headers: auth(),
    });
    const initial = get.json<{ key: string; enabled: boolean; snippet: string }>();
    expect(initial.enabled).toBe(false);
    expect(initial.key).toMatch(/^pk_/);
    expect(initial.snippet).toContain(`data-key="${initial.key}"`);
    key = initial.key;

    const frameOff = await h.app.inject({ method: "GET", url: `/api/public/chat/${key}/frame` });
    expect(frameOff.statusCode).toBe(404);

    const put = await h.app.inject({
      method: "PUT",
      url: `/api/tenants/${owner.tenantId}/widget`,
      headers: auth(),
      payload: {
        enabled: true,
        allowedOrigins: ["shop.example.com/contact", SHOP],
        color: "#0f766e",
        title: "Chat with Widget Co",
        position: "right",
      },
    });
    expect(put.json()).toMatchObject({ enabled: true, allowedOrigins: [SHOP] });
  });

  it("is private to the business", async () => {
    const other = await createOwnerWithTenant(h, "Other Widget Co");
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${owner.tenantId}/widget`,
      headers: { cookie: other.cookie, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("public website chat", () => {
  it("serves the loader and a frame only the business's websites can embed", async () => {
    const js = await h.app.inject({ method: "GET", url: "/api/public/widget.js" });
    expect(js.headers["content-type"]).toMatch(/javascript/);
    const frame = await h.app.inject({ method: "GET", url: `/api/public/chat/${key}/frame` });
    expect(frame.statusCode).toBe(200);
    expect(frame.headers["content-security-policy"]).toBe(`frame-ancestors ${ORIGIN} ${SHOP}`);
    expect(frame.body).toContain("Chat with Widget Co");
    expect(frame.body).toMatch(/AI/); // the greeting discloses the assistant
  });

  it("needs the frame's signed token; a claimed origin isn't enough (audit M3)", async () => {
    const token = await widgetToken(h, key);
    for (const payload of [
      { origin: SHOP },
      { token: "9999999999.forged" },
      { token: token.replace(/.$/, (c) => (c === "A" ? "B" : "A")) },
      { token: `${Math.floor(Date.now() / 1000) - 10}.${token.split(".")[1]}` },
    ]) {
      const res = await h.app.inject({
        method: "POST",
        url: `/api/public/chat/${key}/session`,
        headers: { origin: ORIGIN },
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(403);
    }
    // A token for one business's widget doesn't work for another's.
    const events = await h.app.inject({
      method: "GET",
      url: `/api/public/chat/${key}/events?visitorId=${"v".repeat(24)}&t=${encodeURIComponent("1.x")}`,
    });
    expect(events.statusCode).toBe(403);
  });

  it("chats: streams the reply and creates a web chat thread", async () => {
    const session = await h.app.inject({
      method: "POST",
      url: `/api/public/chat/${key}/session`,
      headers: { origin: ORIGIN },
      payload: { token: await widgetToken(h, key) },
    });
    const { visitorId, messages } = session.json<{ visitorId: string; messages: unknown[] }>();
    expect(visitorId).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(messages).toEqual([]);

    llm.enqueue(MockLlmProvider.text("We're open nine to five."));
    const res = await h.app.inject({
      method: "POST",
      url: `/api/public/chat/${key}/messages`,
      headers: { origin: ORIGIN },
      payload: {
        visitorId,
        token: await widgetToken(h, key),
        text: "When are you open?",
        typedMs: 4000,
      },
    });
    const events = parseSse(res.body);
    expect(
      events
        .filter((e) => e.event === "delta")
        .map((e) => e.data.text)
        .join(""),
    ).toBe("We're open nine to five.");
    expect(events.at(-1)).toMatchObject({ event: "done", data: { mode: "ai", queued: false } });

    const [thread] = await withTenant(h.db, owner.tenantId, (tx) =>
      tx.select().from(channelThreads).where(eq(channelThreads.externalId, visitorId)),
    );
    expect(thread).toMatchObject({ channel: "web_chat", mode: "ai" });
    const [conv] = await withTenant(h.db, owner.tenantId, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, thread!.conversationId!)),
    );
    expect(conv?.channel).toBe("web_chat");

    // Resuming shows the conversation so far (greeting, question, answer).
    const resumed = await h.app.inject({
      method: "POST",
      url: `/api/public/chat/${key}/session`,
      headers: { origin: ORIGIN },
      payload: { token: await widgetToken(h, key), visitorId },
    });
    expect(
      resumed.json<{ messages: Array<{ role: string }> }>().messages.map((m) => m.role),
    ).toEqual(["agent", "caller", "agent"]);
  });

  it("turns away bots (honeypot, instant sends)", async () => {
    const { visitorId } = (
      await h.app.inject({
        method: "POST",
        url: `/api/public/chat/${key}/session`,
        headers: { origin: ORIGIN },
        payload: { token: await widgetToken(h, key) },
      })
    ).json<{ visitorId: string }>();
    for (const extra of [{ website: "http://spam" }, { typedMs: 50 }]) {
      const res = await h.app.inject({
        method: "POST",
        url: `/api/public/chat/${key}/messages`,
        headers: { origin: ORIGIN },
        payload: {
          visitorId,
          token: await widgetToken(h, key),
          text: "buy now",
          typedMs: 4000,
          ...extra,
        },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
