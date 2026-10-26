import { MockLlmProvider, type EmbeddingProvider, type LlmProvider } from "@voicedesk/adapters";
import { processKnowledgeGaps } from "@voicedesk/agent-brain";
import {
  gapAnswers,
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeGaps,
  knowledgeSources,
  withTenant,
} from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, type TestHarness } from "./harness";

let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

/** Unit vectors: the same "meaning" gives the same direction. */
function unit(axis: number, wobble = 0): number[] {
  const v = new Array<number>(384).fill(0);
  v[axis] = 1;
  v[axis + 1] = wobble;
  const norm = Math.hypot(1, wobble);
  return v.map((x) => x / norm);
}
const MEANING: Record<string, number[]> = {
  "Are you open on Saturdays?": unit(0),
  "Do you open Saturday mornings?": unit(0, 0.2),
  "Do you take American Express?": unit(10),
  "Saturday hours": unit(0, 0.1),
};
const embeddings: EmbeddingProvider = {
  name: "stub",
  model: "stub",
  dimensions: 384,
  embed: (texts) => Promise.resolve(texts.map((t) => MEANING[t] ?? unit(50))),
};

function llmSaying(text: string): LlmProvider & { calls: number } {
  const stub = {
    name: "stub-llm",
    calls: 0,
    available: () => Promise.resolve(true),
    complete() {
      stub.calls++;
      return Promise.resolve(MockLlmProvider.text(text));
    },
    stream() {
      return Promise.resolve(MockLlmProvider.text(text));
    },
  };
  return stub;
}

async function seed(tenantId: string, questions: string[]) {
  await withTenant(h.db, tenantId, async (tx) => {
    const [source] = await tx
      .insert(knowledgeSources)
      .values({ tenantId, type: "text", title: "Opening hours", textContent: "x" })
      .returning();
    const [doc] = await tx
      .insert(knowledgeDocuments)
      .values({
        tenantId,
        sourceId: source!.id,
        url: "text:hours",
        title: "Opening hours",
        contentHash: "h",
        text: "x",
      })
      .returning();
    await tx.insert(knowledgeChunks).values({
      tenantId,
      sourceId: source!.id,
      documentId: doc!.id,
      ordinal: 0,
      content: "We are open Saturday 9am to 1pm.",
      tokenCount: 8,
      embedding: MEANING["Saturday hours"]!,
      embeddingModel: "stub",
    });
    for (const question of questions) {
      await tx.insert(knowledgeGaps).values({ tenantId, question });
    }
  });
}

describe("unanswered questions", () => {
  it("groups the same question asked differently and drafts from the documents", async () => {
    const biz = await createOwnerWithTenant(h, "Gaps Co");
    await seed(biz.tenantId, [
      "Are you open on Saturdays?",
      "Do you open Saturday mornings?",
      "Do you take American Express?",
    ]);
    const llm = llmSaying("Yes, we're open on Saturdays from 9am to 1pm.");
    const result = await processKnowledgeGaps({ db: h.db, llm, embeddings }, new Date(), [
      biz.tenantId,
    ]);
    expect(result.grouped).toBe(3);
    const groups = await withTenant(h.db, biz.tenantId, (tx) =>
      tx.select().from(gapAnswers).where(eq(gapAnswers.tenantId, biz.tenantId)),
    );
    expect(groups).toHaveLength(2);
    const saturday = groups.find((g) => g.question === "Are you open on Saturdays?")!;
    expect(saturday.count).toBe(2);
    expect(saturday.draft).toBe("Yes, we're open on Saturdays from 9am to 1pm.");
    expect(saturday.sources[0]).toMatchObject({ title: "Opening hours" });
    // Nothing in the documents about card types: no draft, the owner writes it.
    const amex = groups.find((g) => g.question === "Do you take American Express?")!;
    expect(amex.draft).toBeNull();
    expect(amex.draftedAt).not.toBeNull();

    // Running again does nothing new; a new wording joins the group.
    await withTenant(h.db, biz.tenantId, (tx) =>
      tx.insert(knowledgeGaps).values({ tenantId: biz.tenantId, question: "Saturday hours" }),
    );
    const again = await processKnowledgeGaps({ db: h.db, llm, embeddings }, new Date(), [
      biz.tenantId,
    ]);
    expect(again).toEqual({ grouped: 1, drafted: 0 });
    const [updated] = await withTenant(h.db, biz.tenantId, (tx) =>
      tx.select().from(gapAnswers).where(eq(gapAnswers.id, saturday.id)),
    );
    expect(updated!.count).toBe(3);
  });

  it("the model saying it's not in the documents gives no draft", async () => {
    const biz = await createOwnerWithTenant(h, "Gaps Two Co");
    await seed(biz.tenantId, ["Are you open on Saturdays?"]);
    const llm = llmSaying("NOT_FOUND");
    await processKnowledgeGaps({ db: h.db, llm, embeddings }, new Date(), [biz.tenantId]);
    const [group] = await withTenant(h.db, biz.tenantId, (tx) =>
      tx.select().from(gapAnswers).where(eq(gapAnswers.tenantId, biz.tenantId)),
    );
    expect(group!.draft).toBeNull();
    expect(llm.calls).toBe(1);
  });
});
