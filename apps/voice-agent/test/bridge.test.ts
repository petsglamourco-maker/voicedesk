import { llm } from "@livekit/agents";
import { MockEmbeddingProvider, MockLlmProvider, type LlmProvider } from "@voicedesk/adapters";
import {
  loadAgentContext,
  loadConversationState,
  startConversation,
  type Lang,
} from "@voicedesk/agent-brain";
import { closeDb, conversationMessages, conversations, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engineReplyStream, newCallerText } from "../src/agent";
import { EngineBridge, median, type TurnTimings } from "../src/bridge";
import { callerFromSip, parseJobMetadata } from "../src/job";

let dbs: TestDbs;
let tenantId: string;

beforeAll(async () => {
  dbs = connectTestDbs();
  tenantId = await createTestTenant(dbs.app, "Voice Bridge Co");
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

async function newConversation() {
  const ctx = await loadAgentContext(dbs.app, tenantId, "voice");
  const { state, greeting } = startConversation(ctx);
  const conversationId = await withTenant(dbs.app, tenantId, async (tx) => {
    const [row] = await tx
      .insert(conversations)
      .values({
        tenantId,
        channel: "test_console",
        style: "voice",
        personaId: ctx.persona.id,
        language: state.language,
        state: state as unknown as Record<string, unknown>,
      })
      .returning({ id: conversations.id });
    await tx.insert(conversationMessages).values({
      tenantId,
      conversationId: row!.id,
      role: "agent",
      content: greeting,
      language: state.language,
    });
    return row!.id;
  });
  return { ctx, state, conversationId };
}

async function readAll(stream: ReadableStream<string>): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk;
  return out;
}

const noTimings = { pending: () => ({}), report: () => undefined };

describe("EngineBridge", () => {
  it("streams the engine reply and saves the turn with voice latency", async () => {
    const { ctx, state, conversationId } = await newConversation();
    const model = new MockLlmProvider().enqueue(MockLlmProvider.text("We open at nine."));
    const bridge = new EngineBridge(
      { db: dbs.app, llm: model, embeddings: new MockEmbeddingProvider() },
      ctx,
      { tenantId, conversationId },
      state,
    );
    const reported: TurnTimings[] = [];
    const text = await readAll(
      engineReplyStream(bridge, "When do you open?", {
        pending: () => ({ endOfUtteranceMs: 300 }),
        report: (t) => reported.push({ ...t }),
      }),
    );
    expect(text).toBe("We open at nine.");
    await bridge.drain();
    expect(bridge.turns).toBe(1);
    expect(reported.at(-1)).toMatchObject({ endOfUtteranceMs: 300 });
    expect(reported.at(-1)?.llmFirstTextMs).toBeTypeOf("number");
    expect(reported.at(-1)?.engineMs).toBeTypeOf("number");

    const messages = await withTenant(dbs.app, tenantId, (tx) =>
      tx
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversationId))
        .orderBy(asc(conversationMessages.id)),
    );
    expect(messages.map((m) => m.role)).toEqual(["agent", "caller", "agent"]);
    expect(messages[2]?.metadata).toMatchObject({
      channel: "voice",
      latency: { endOfUtteranceMs: 300 },
    });
    // The voice style rules were in the system prompt.
    expect(model.requests[0]?.system.join(" ")).toMatch(/spoken|voice|call/i);
  });

  it("serialises overlapping turns so neither is lost", async () => {
    const { ctx, state, conversationId } = await newConversation();
    const model = new MockLlmProvider().enqueue(
      MockLlmProvider.text("First answer."),
      MockLlmProvider.text("Second answer."),
    );
    const bridge = new EngineBridge(
      { db: dbs.app, llm: model, embeddings: new MockEmbeddingProvider() },
      ctx,
      { tenantId, conversationId },
      state,
    );
    const [a, b] = await Promise.all([
      readAll(engineReplyStream(bridge, "Hello there", noTimings)),
      readAll(engineReplyStream(bridge, "And one more thing", noTimings)),
    ]);
    expect([a, b]).toEqual(["First answer.", "Second answer."]);
    const saved = await loadConversationState(dbs.app, tenantId, conversationId);
    expect(saved?.state.turns).toBe(2);
  });

  it("keeps saving the turn after the caller interrupts", async () => {
    const { ctx, state, conversationId } = await newConversation();
    const model = new MockLlmProvider().enqueue(MockLlmProvider.text("A long answer."));
    const bridge = new EngineBridge(
      { db: dbs.app, llm: model, embeddings: new MockEmbeddingProvider() },
      ctx,
      { tenantId, conversationId },
      state,
    );
    const stream = engineReplyStream(bridge, "What services do you have?", noTimings);
    await stream.cancel("barge-in");
    await bridge.drain();
    const saved = await loadConversationState(dbs.app, tenantId, conversationId);
    expect(saved?.state.turns).toBe(1);
  });

  it("says a hold-on phrase when the reply is slow", async () => {
    const { ctx, state, conversationId } = await newConversation();
    const inner = new MockLlmProvider().enqueue(MockLlmProvider.text("Found it."));
    const slow: LlmProvider = {
      name: "slow",
      complete: (r) => inner.complete(r),
      stream: async (r, onText) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return inner.stream(r, onText);
      },
    };
    const bridge = new EngineBridge(
      { db: dbs.app, llm: slow, embeddings: new MockEmbeddingProvider() },
      ctx,
      { tenantId, conversationId },
      state,
    );
    const reported: TurnTimings[] = [];
    const text = await readAll(
      engineReplyStream(
        bridge,
        "Do you have parking?",
        { pending: () => ({}), report: (t) => reported.push({ ...t }) },
        30,
      ),
    );
    expect(text).toBe("Just a moment. Found it.");
    expect(reported.at(-1)?.filler).toBe(true);
    expect(bridge.lastTurnHadFiller).toBe(true);
    // The next slow reply uses different words.
    inner.enqueue(MockLlmProvider.text("Here you go."));
    const second = await readAll(
      engineReplyStream(bridge, "And the address?", { pending: () => ({}), report: () => {} }, 30),
    );
    expect(second).toBe("One second, please. Here you go.");
  });

  it("reports a language switch so speech recognition and TTS follow it", async () => {
    const { ctx, state, conversationId } = await newConversation();
    const switched: Lang[] = [];
    const model = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("set_language", { language: "zh" }),
      MockLlmProvider.text("当然可以。"),
    );
    const bridge = new EngineBridge(
      { db: dbs.app, llm: model, embeddings: new MockEmbeddingProvider() },
      ctx,
      { tenantId, conversationId },
      state,
      { onLanguage: (l) => switched.push(l) },
    );
    await readAll(engineReplyStream(bridge, "Can we continue in Mandarin please?", noTimings));
    expect(switched).toEqual(["zh"]);
    expect(bridge.language).toBe("zh");
  });
});

describe("helpers", () => {
  it("takes the caller's words since the agent last spoke", () => {
    const chat = llm.ChatContext.empty();
    chat.addMessage({ role: "assistant", content: "Hello, how can I help?" });
    chat.addMessage({ role: "user", content: "I'd like to book" });
    chat.addMessage({ role: "user", content: "a check-up please" });
    expect(newCallerText(chat)).toBe("I'd like to book a check-up please");
    chat.addMessage({ role: "assistant", content: "Sure." });
    expect(newCallerText(chat)).toBe("");
  });

  it("parses dispatch metadata strictly", () => {
    expect(parseJobMetadata('{"tenantId":"t","conversationId":"c"}')).toEqual({
      kind: "browser",
      tenantId: "t",
      conversationId: "c",
    });
    expect(parseJobMetadata('{"tenantId":"t","phoneNumberId":"p"}')).toEqual({
      kind: "phone",
      tenantId: "t",
      phoneNumberId: "p",
    });
    // ADR 0029: instant demos are marked and capped (30 s to 10 min, 3 min by default).
    expect(
      parseJobMetadata('{"tenantId":"t","conversationId":"c","demo":true,"maxSeconds":180}'),
    ).toEqual({ kind: "browser", tenantId: "t", conversationId: "c", demo: true, maxSeconds: 180 });
    expect(
      parseJobMetadata('{"tenantId":"t","conversationId":"c","demo":true,"maxSeconds":99999}'),
    ).toMatchObject({ maxSeconds: 600 });
    expect(parseJobMetadata('{"tenantId":"t","conversationId":"c","demo":true}')).toMatchObject({
      maxSeconds: 180,
    });
    expect(() => parseJobMetadata("")).toThrow();
    expect(() => parseJobMetadata('{"tenantId":1}')).toThrow();
    expect(() => parseJobMetadata('{"tenantId":"t"}')).toThrow();
  });

  it("reads the caller's number, or treats it as withheld", () => {
    expect(callerFromSip({ "sip.phoneNumber": "+447700900123" })).toEqual({
      callerPhone: "+447700900123",
      withheld: false,
    });
    expect(callerFromSip({ "sip.phoneNumber": "447700900123" }).callerPhone).toBe("+447700900123");
    const hiddenCases: Record<string, string>[] = [
      {},
      { "sip.phoneNumber": "" },
      { "sip.phoneNumber": "anonymous" },
    ];
    for (const hidden of hiddenCases) {
      expect(callerFromSip(hidden)).toEqual({ callerPhone: null, withheld: true });
    }
  });

  it("computes medians", () => {
    expect(median([300, undefined, 100, 200])).toBe(200);
    expect(median([100, 200])).toBe(150);
    expect(median([])).toBeNull();
  });
});
