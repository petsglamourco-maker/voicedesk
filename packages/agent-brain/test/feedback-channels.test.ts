import { MockEmbeddingProvider, MockLlmProvider } from "@voicedesk/adapters";
import { agentSettings, closeDb, conversations, feedback, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleInboundMessage } from "../src/channels";
import { planFeedbackRequest } from "../src/notifications";
import { createConversation } from "../src/persistence";
import type { AgentNotification } from "../src/services-db";
import { makeContext } from "./fixtures";

let dbs: TestDbs;
let tenantId: string;

beforeAll(async () => {
  dbs = connectTestDbs();
  tenantId = await createTestTenant(dbs.app, "Rating Co");
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

const deps = (llm: MockLlmProvider, events: AgentNotification[] = []) => ({
  db: dbs.app,
  llm,
  embeddings: new MockEmbeddingProvider(),
  notify: (e: AgentNotification) => Promise.resolve(void events.push(e)),
});

describe("in-chat surveys", () => {
  it("asks when the assistant says goodbye; a bare score answers it; low scores alert", async () => {
    const who = {
      tenantId,
      channel: "whatsapp" as const,
      externalId: `+4477009${Date.now() % 100000}`,
    };
    await handleInboundMessage(
      deps(new MockLlmProvider().enqueue(MockLlmProvider.text("Hi! How can I help?"))),
      who,
      "Hello",
    );
    const bye = await handleInboundMessage(
      deps(
        new MockLlmProvider().enqueue(
          MockLlmProvider.toolUse("end_conversation", {}, "Glad I could help. Goodbye!"),
          MockLlmProvider.text("Glad I could help. Goodbye!"),
        ),
      ),
      who,
      "That's all, thanks",
    );
    expect(bye.survey).toMatchObject({ kind: "csat" });
    expect(bye.survey!.question).toMatch(/1 \(poor\) to 5/);

    const events: AgentNotification[] = [];
    const answer = await handleInboundMessage(deps(new MockLlmProvider(), events), who, "2");
    expect(answer).toMatchObject({ surveyAnswered: true, reply: "Thank you for your feedback!" });
    expect(events).toEqual([expect.objectContaining({ kind: "staff.alert", record: "feedback" })]);
    const [row] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(feedback).where(eq(feedback.conversationId, answer.conversationId)),
    );
    expect(row).toMatchObject({ score: 2, channel: "whatsapp" });

    // Afterwards, a number is just a message again (e.g. "2 people").
    const llm = new MockLlmProvider().enqueue(MockLlmProvider.text("For how many people?"));
    const next = await handleInboundMessage(deps(llm), who, "3");
    expect(next.surveyAnswered).toBeUndefined();
    expect(next.reply).toBe("For how many people?");
  });
});

describe("rating links after calls and emails", () => {
  it("texts callers only when the business switched it on; never withheld numbers", async () => {
    const t = await createTestTenant(dbs.app, "Calls Rating Co");
    const call = async (callerPhone: string | null, withheld = false) => {
      const { conversationId } = await createConversation(
        dbs.app,
        makeContext({ style: "voice" }),
        {
          tenantId: t,
          channel: "voice",
          callerPhone,
        },
      );
      if (withheld) {
        await withTenant(dbs.app, t, (tx) =>
          tx
            .update(conversations)
            .set({ callerNumberWithheld: true })
            .where(eq(conversations.id, conversationId)),
        );
      }
      return conversationId;
    };
    const origin = "https://app.example";
    expect(
      (
        await planFeedbackRequest(
          dbs.app,
          { tenantId: t, conversationId: await call("+447700900123") },
          origin,
        )
      ).messages,
    ).toEqual([]);

    await withTenant(dbs.app, t, (tx) =>
      tx.insert(agentSettings).values({ tenantId: t, feedbackAfterCalls: true }),
    );
    const plan = await planFeedbackRequest(
      dbs.app,
      {
        tenantId: t,
        conversationId: await call("+447700900456"),
      },
      origin,
    );
    expect(plan.messages).toEqual([
      expect.objectContaining({ channel: "sms", kind: "feedback.request" }),
    ]);
    expect(plan.messages[0]!.text).toMatch(new RegExp(`${origin}/r/${t}\\.`));
    expect(
      (
        await planFeedbackRequest(
          dbs.app,
          { tenantId: t, conversationId: await call(null, true) },
          origin,
        )
      ).messages,
    ).toEqual([]);
  });
});
