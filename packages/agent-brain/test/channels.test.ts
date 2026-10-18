import { randomUUID } from "node:crypto";
import { MockEmbeddingProvider, MockLlmProvider } from "@voicedesk/adapters";
import {
  channelThreads,
  closeDb,
  conversationMessages,
  conversations,
  publicEndpoints,
  withTenant,
} from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleInboundMessage,
  recordHumanReply,
  resolvePublicEndpoint,
  setThreadMode,
} from "../src/channels";
import type { AgentNotification } from "../src/services-db";
import type { ConversationState } from "../src/state";

let dbs: TestDbs;
let tenantId: string;

beforeAll(async () => {
  dbs = connectTestDbs();
  tenantId = await createTestTenant(dbs.app, "Channels Co");
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

function deps(llm: MockLlmProvider, events: AgentNotification[] = []) {
  return {
    db: dbs.app,
    llm,
    embeddings: new MockEmbeddingProvider(),
    notify: (e: AgentNotification) => Promise.resolve(void events.push(e)),
  };
}

const visitor = () => ({ tenantId, channel: "web_chat" as const, externalId: `v_${randomUUID()}` });

describe("text channel pipeline", () => {
  it("starts a conversation with the AI greeting, answers, and keeps the thread going", async () => {
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.text("We open at nine."),
      MockLlmProvider.text("Yes, there is parking."),
    );
    const who = visitor();
    const deltas: string[] = [];
    const first = await handleInboundMessage(deps(llm), who, "When do you open?", {
      onText: (d) => deltas.push(d),
    });
    expect(first.mode).toBe("ai");
    expect(first.greeting).toMatch(/AI/);
    expect(first.reply).toBe("We open at nine.");
    expect(deltas.join("")).toBe("We open at nine.");

    const second = await handleInboundMessage(deps(llm), who, "Parking?");
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.greeting).toBeNull();

    const [conv] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, first.conversationId)),
    );
    expect(conv).toMatchObject({ channel: "web_chat", style: "chat" });
    expect((conv!.state as unknown as ConversationState).turns).toBe(2);
  });

  it("starts a fresh conversation after a day of quiet and ends the old one", async () => {
    const llm = new MockLlmProvider();
    const who = visitor();
    const first = await handleInboundMessage(deps(llm), who, "Hello");
    const later = new Date(Date.now() + 25 * 3600 * 1000);
    const next = await handleInboundMessage(deps(llm), who, "Hello again", { now: later });
    expect(next.conversationId).not.toBe(first.conversationId);
    expect(next.greeting).toMatch(/AI/);
    const [old] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, first.conversationId)),
    );
    expect(old?.status).toBe("ended");
  });

  it("lets a person take over (the assistant stays quiet) and hand back with a note", async () => {
    const llm = new MockLlmProvider().enqueue(MockLlmProvider.text("Hi!"));
    const who = visitor();
    const first = await handleInboundMessage(deps(llm), who, "Hi");
    await setThreadMode(dbs.app, tenantId, first.threadId, "human", randomUUID());
    const requestsBefore = llm.requests.length;
    const waiting = await handleInboundMessage(deps(llm), who, "Is anyone there?");
    expect(waiting).toMatchObject({ mode: "human", reply: null });
    expect(llm.requests.length).toBe(requestsBefore);

    const sent = await recordHumanReply(
      dbs.app,
      tenantId,
      first.threadId,
      { userId: randomUUID(), name: "Priya" },
      "Hi, Priya here. How can I help?",
    );
    expect(sent).toMatchObject({ channel: "web_chat", externalId: who.externalId });

    await setThreadMode(dbs.app, tenantId, first.threadId, "ai", randomUUID());
    const [conv] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, first.conversationId)),
    );
    const history = (conv!.state as unknown as ConversationState).history;
    expect(JSON.stringify(history.at(-1))).toContain("Priya here");
    const messages = await withTenant(dbs.app, tenantId, (tx) =>
      tx
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, first.conversationId))
        .orderBy(asc(conversationMessages.id)),
    );
    expect(messages.map((m) => m.role)).toEqual(["agent", "caller", "agent", "caller", "agent"]);
  });

  it("flags the thread and alerts staff when the customer asks for a person", async () => {
    const events: AgentNotification[] = [];
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("request_human", { reason: "Wants a person" }),
      MockLlmProvider.text("I've asked a member of the team to reply here."),
    );
    const res = await handleInboundMessage(deps(llm, events), visitor(), "Can I talk to a human?");
    const [thread] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(channelThreads).where(eq(channelThreads.id, res.threadId)),
    );
    expect(thread?.needsHuman).toBe(true);
    expect(events).toContainEqual({ kind: "staff.alert", record: "handoff", id: res.threadId });
  });

  it("recognises a returning WhatsApp customer by their number", async () => {
    const llm = new MockLlmProvider();
    const who = {
      tenantId,
      channel: "whatsapp" as const,
      externalId: "+447700900888",
      phone: "+447700900888",
    };
    const res = await handleInboundMessage(deps(llm), who, "Hi");
    const [conv] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, res.conversationId)),
    );
    expect((conv!.state as unknown as ConversationState).callerPhone).toBe("+447700900888");
  });
});

describe("resolvePublicEndpoint", () => {
  it("finds a business by its widget key", async () => {
    const key = `pk_${randomUUID().replace(/-/g, "")}`;
    await withTenant(dbs.app, tenantId, (tx) =>
      tx
        .insert(publicEndpoints)
        .values({ tenantId, kind: "widget", key, config: { color: "#123456" } }),
    );
    expect(await resolvePublicEndpoint(dbs.app, "widget", key)).toMatchObject({
      tenantId,
      enabled: true,
      config: { color: "#123456" },
    });
    expect(await resolvePublicEndpoint(dbs.app, "widget", "pk_nope")).toBeNull();
  });
});
