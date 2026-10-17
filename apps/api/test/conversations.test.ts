import { MockLlmProvider } from "@voicedesk/adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;
const llm = new MockLlmProvider();

function parseSse(payload: string): Array<{ event: string; data: unknown }> {
  return payload
    .split("\n\n")
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? "message";
      const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? "null") as unknown;
      return { event, data };
    });
}

beforeAll(async () => {
  h = await createHarness({ llm });
  owner = await createOwnerWithTenant(h, "Chat Co");
});

afterAll(() => h.close());

const base = () => `/api/tenants/${owner.tenantId}`;
const headers = () => ({ cookie: owner.cookie, origin: ORIGIN });

describe("agent settings", () => {
  it("defaults to Amelia and saves a renamed persona", async () => {
    const before = await h.app.inject({
      method: "GET",
      url: `${base()}/agent`,
      headers: headers(),
    });
    expect(before.json<{ settings: { personaId: string } }>().settings.personaId).toBe("amelia");

    const put = await h.app.inject({
      method: "PUT",
      url: `${base()}/agent`,
      headers: headers(),
      payload: {
        personaId: "daniel",
        personaNames: { daniel: "Dan" },
        enabledLanguages: ["en", "es"],
        adminLanguage: "en",
      },
    });
    expect(put.statusCode).toBe(204);
  });
});

describe("test console conversation", () => {
  let conversationId: string;

  it("starts with the renamed persona's greeting and AI disclosure", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `${base()}/conversations`,
      headers: headers(),
      payload: { style: "chat" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; greeting: string; hasProfile: boolean }>();
    expect(body.greeting).toContain("I'm Dan, the AI assistant");
    expect(body.hasProfile).toBe(false);
    conversationId = body.id;
  });

  it("streams a turn, runs tools and stores the message record", async () => {
    llm.enqueue(
      MockLlmProvider.toolUse("set_intent", { intent: "message" }),
      MockLlmProvider.toolUse("update_message", {
        callerName: "Jo Bloggs",
        callerPhone: "07700 900111",
        phoneConfirmed: true,
        reason: "Wants a quote",
        urgency: "normal",
        bestTime: "Afternoons",
      }),
      MockLlmProvider.toolUse("take_message", { callerConfirmed: true }),
      MockLlmProvider.text("Thanks Jo, I've passed that on."),
    );
    const res = await h.app.inject({
      method: "POST",
      url: `${base()}/conversations/${conversationId}/messages`,
      headers: headers(),
      payload: { text: "Please ask someone to call me about a quote" },
    });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = parseSse(res.payload);
    expect(events.filter((e) => e.event === "delta").length).toBeGreaterThan(0);
    const done = events.find((e) => e.event === "done")?.data as {
      reply: string;
      view: { flow: string; records: Array<{ type: string; reference: string }> };
    };
    expect(done.reply).toContain("passed that on");
    expect(done.view.records[0]).toMatchObject({ type: "message" });
    expect(done.view.records[0]!.reference).toMatch(/^CC-[2-9A-Z]{4}$/);

    const records = await h.app.inject({
      method: "GET",
      url: `${base()}/records`,
      headers: headers(),
    });
    expect(records.json<{ messages: Array<{ callerPhone: string }> }>().messages[0]).toMatchObject({
      callerPhone: "+447700900111",
    });

    const convo = await h.app.inject({
      method: "GET",
      url: `${base()}/conversations/${conversationId}`,
      headers: headers(),
    });
    expect(convo.json<{ messages: unknown[] }>().messages).toHaveLength(3);
  });

  it("ends the conversation and queues a summary", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `${base()}/conversations/${conversationId}/end`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(202);
    expect(h.jobs.ai).toContainEqual({
      kind: "conversation.summarize",
      tenantId: owner.tenantId,
      conversationId,
    });

    const after = await h.app.inject({
      method: "POST",
      url: `${base()}/conversations/${conversationId}/messages`,
      headers: headers(),
      payload: { text: "hello?" },
    });
    expect(after.statusCode).toBe(409);
  });

  it("hides conversations from other tenants", async () => {
    const other = await createOwnerWithTenant(h, "Other Co");
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${other.tenantId}/conversations/${conversationId}`,
      headers: { cookie: other.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
