import { agentSettings, closeDb, contacts, conversations, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  feedbackStats,
  openSurvey,
  parseScore,
  pendingSurvey,
  recordFeedback,
  surveyByToken,
  surveyQuestion,
} from "../src/feedback";
import { createConversation } from "../src/persistence";
import { makeContext } from "./fixtures";

describe("parseScore", () => {
  it.each([
    ["4", "csat", 4],
    [" 5 ", "csat", 5],
    ["3/5", "csat", 3],
    ["10!", "nps", 10],
    ["0", "nps", 0],
    ["0", "csat", null],
    ["6", "csat", null],
    ["4 stars please call me", "csat", null],
    ["Can I book for Tuesday?", "csat", null],
  ] as const)("%s (%s) → %s", (text, kind, expected) => {
    expect(parseScore(text, kind)).toBe(expected);
  });
});

describe("feedbackStats", () => {
  it("CSAT is the share of 4s and 5s; NPS is promoters minus detractors", () => {
    expect(
      feedbackStats([
        { kind: "csat", score: 5 },
        { kind: "csat", score: 4 },
        { kind: "csat", score: 2 },
        { kind: "csat", score: null },
        { kind: "nps", score: 10 },
        { kind: "nps", score: 9 },
        { kind: "nps", score: 7 },
        { kind: "nps", score: 3 },
      ]),
    ).toEqual({
      sent: 8,
      answered: 7,
      csat: 67,
      csatAverage: 3.7,
      nps: 25,
      npsAnswers: 4,
      reviewsOffered: 0,
      reviewsOpened: 0,
    });
    expect(feedbackStats([]).csat).toBeNull();
  });
});

describe("surveys", () => {
  let dbs: TestDbs;
  let tenantId: string;
  beforeAll(async () => {
    dbs = connectTestDbs();
    tenantId = await createTestTenant(dbs.app, "Feedback Co");
  });
  afterAll(async () => {
    await closeDb(dbs.app);
    await closeDb(dbs.owner);
  });

  async function conversation(contactId: string | null = null, channel = "web_chat" as const) {
    const { conversationId } = await createConversation(dbs.app, makeContext(), {
      tenantId,
      channel,
    });
    if (contactId) {
      await withTenant(dbs.app, tenantId, (tx) =>
        tx.update(conversations).set({ contactId }).where(eq(conversations.id, conversationId)),
      );
    }
    return conversationId;
  }

  it("one survey per conversation; answers once; low scores flagged", async () => {
    const conversationId = await conversation();
    const survey = await openSurvey(dbs.app, { tenantId, conversationId, channel: "web_chat" });
    expect(survey).toMatchObject({ kind: "csat", language: "en" });
    expect(survey!.token.startsWith(`${tenantId}.`)).toBe(true);
    expect(await openSurvey(dbs.app, { tenantId, conversationId, channel: "web_chat" })).toBeNull();

    expect((await pendingSurvey(dbs.app, tenantId, conversationId))?.id).toBe(survey!.id);
    const first = await recordFeedback(dbs.app, tenantId, survey!.id, { score: 2 });
    expect(first).toMatchObject({ low: true, first: true, row: { score: 2, handledBy: "ai" } });
    const again = await recordFeedback(dbs.app, tenantId, survey!.id, {
      score: 5,
      comment: "Actually it was fine",
    });
    expect(again).toMatchObject({
      first: false,
      row: { score: 2, comment: "Actually it was fine" },
    });
    expect(await pendingSurvey(dbs.app, tenantId, conversationId)).toBeNull();
    expect((await surveyByToken(dbs.app, survey!.token))?.id).toBe(survey!.id);
    expect(await surveyByToken(dbs.app, "not-a-token")).toBeNull();
  });

  it("doesn't ask the same customer twice within 30 days", async () => {
    const [contact] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.insert(contacts).values({ tenantId, fullName: "Sam" }).returning({ id: contacts.id }),
    );
    const c1 = await conversation(contact!.id);
    const c2 = await conversation(contact!.id);
    expect(
      await openSurvey(dbs.app, { tenantId, conversationId: c1, channel: "web_chat" }),
    ).not.toBeNull();
    expect(
      await openSurvey(dbs.app, { tenantId, conversationId: c2, channel: "web_chat" }),
    ).toBeNull();
  });

  it("respects the business's settings: off, calls opt-in, every Nth is NPS", async () => {
    const t2 = await createTestTenant(dbs.app, "Settings Co");
    const conv = async () =>
      (await createConversation(dbs.app, makeContext(), { tenantId: t2, channel: "web_chat" }))
        .conversationId;
    await withTenant(dbs.app, t2, (tx) =>
      tx.insert(agentSettings).values({ tenantId: t2, feedbackEnabled: true, npsEvery: 2 }),
    );
    // Phone calls need "text after calls" switched on.
    expect(
      await openSurvey(dbs.app, {
        tenantId: t2,
        conversationId: await conv(),
        channel: "voice",
        afterCall: true,
      }),
    ).toBeNull();
    const a = await openSurvey(dbs.app, {
      tenantId: t2,
      conversationId: await conv(),
      channel: "web_chat",
    });
    const b = await openSurvey(dbs.app, {
      tenantId: t2,
      conversationId: await conv(),
      channel: "web_chat",
    });
    expect([a?.kind, b?.kind]).toEqual(["csat", "nps"]);
    expect(surveyQuestion("en", "nps", "Settings Co")).toContain("recommend Settings Co");

    await withTenant(dbs.app, t2, (tx) => tx.update(agentSettings).set({ feedbackEnabled: false }));
    expect(
      await openSurvey(dbs.app, {
        tenantId: t2,
        conversationId: await conv(),
        channel: "web_chat",
      }),
    ).toBeNull();
  });
});
