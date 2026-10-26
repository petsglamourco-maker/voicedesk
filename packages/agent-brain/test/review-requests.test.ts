import {
  agentSettings,
  closeDb,
  contacts,
  conversations,
  feedback,
  withTenant,
} from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  offerReview,
  openReviewLink,
  openSurvey,
  recordFeedback,
  reviewInvite,
  validReviewLink,
} from "../src/feedback";
import { LANGUAGES } from "../src/languages";
import { createConversation } from "../src/persistence";
import { makeContext } from "./fixtures";

const LINK = "https://g.page/r/example/review";

describe("review invitation wording", () => {
  it.each(LANGUAGES)("%s names the business and carries the link", (lang) => {
    const text = reviewInvite(lang, "Glow Studio", LINK);
    expect(text).toContain("Glow Studio");
    expect(text.endsWith(LINK)).toBe(true);
    expect(reviewInvite(lang, "Glow Studio")).not.toContain("https://");
  });

  it("only https pages without logins are review links", () => {
    expect(validReviewLink(LINK)).toBe(true);
    expect(validReviewLink("http://example.com/review")).toBe(false);
    expect(validReviewLink("javascript:alert(1)")).toBe(false);
    expect(validReviewLink("https://user:pw@example.com")).toBe(false);
    expect(validReviewLink(null)).toBe(false);
  });
});

describe("review invitations (ADR 0028)", () => {
  let dbs: TestDbs;
  let tenantId: string;
  beforeAll(async () => {
    dbs = connectTestDbs();
    tenantId = await createTestTenant(dbs.app, "Review Co");
  });
  afterAll(async () => {
    await closeDb(dbs.app);
    await closeDb(dbs.owner);
  });

  async function answered(score: number, contactId: string | null = null, now = new Date()) {
    const { conversationId } = await createConversation(dbs.app, makeContext(), {
      tenantId,
      channel: "web_chat",
    });
    if (contactId) {
      await withTenant(dbs.app, tenantId, (tx) =>
        tx.update(conversations).set({ contactId }).where(eq(conversations.id, conversationId)),
      );
    }
    const survey = await openSurvey(dbs.app, {
      tenantId,
      conversationId,
      channel: "web_chat",
      now,
    });
    await recordFeedback(dbs.app, tenantId, survey!.id, { score }, now);
    return survey!;
  }

  async function settings(values: { reviewRequests: boolean; reviewLink: string | null }) {
    await withTenant(dbs.app, tenantId, (tx) =>
      tx
        .insert(agentSettings)
        .values({ tenantId, ...values })
        .onConflictDoUpdate({ target: agentSettings.tenantId, set: values }),
    );
  }

  it("is off until the business switches it on with a link", async () => {
    const survey = await answered(5);
    expect(await offerReview(dbs.app, tenantId, survey.id)).toBeNull();
    await settings({ reviewRequests: true, reviewLink: null });
    expect(await offerReview(dbs.app, tenantId, survey.id)).toBeNull();
  });

  it("invites everyone who answers, whatever the score, once per survey", async () => {
    await settings({ reviewRequests: true, reviewLink: LINK });
    for (const score of [1, 3, 5]) {
      const survey = await answered(score);
      const offer = await offerReview(dbs.app, tenantId, survey.id);
      expect(offer?.path).toBe(`/api/public/review/${encodeURIComponent(survey.token)}`);
      expect(await offerReview(dbs.app, tenantId, survey.id)).toBeNull();
    }
  });

  it("asks the same customer at most once a year", async () => {
    await settings({ reviewRequests: true, reviewLink: LINK });
    const [contact] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.insert(contacts).values({ tenantId, fullName: "Robin" }).returning({ id: contacts.id }),
    );
    const now = new Date();
    const first = await answered(4, contact!.id);
    expect(await offerReview(dbs.app, tenantId, first.id, now)).not.toBeNull();
    // A month later (surveys allow it again), but no second review invitation.
    const later = new Date(now.getTime() + 40 * 24 * 3600 * 1000);
    const second = await answered(5, contact!.id, later);
    expect(await offerReview(dbs.app, tenantId, second.id, later)).toBeNull();
  });

  it("the tracked link opens only after an invitation, and records the click", async () => {
    await settings({ reviewRequests: true, reviewLink: LINK });
    const notOffered = await answered(5);
    expect(await openReviewLink(dbs.app, notOffered.token)).toBeNull();

    const survey = await answered(2);
    await offerReview(dbs.app, tenantId, survey.id);
    expect(await openReviewLink(dbs.app, survey.token)).toBe(LINK);
    const [row] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(feedback).where(eq(feedback.id, survey.id)),
    );
    expect(row?.reviewClickedAt).toBeInstanceOf(Date);
    expect(await openReviewLink(dbs.app, "nope")).toBeNull();
  });
});
