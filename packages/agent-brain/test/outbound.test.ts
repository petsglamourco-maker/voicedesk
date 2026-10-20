import { closeDb, conversationMessages, outboundCalls, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimDueOutboundCalls,
  createOutboundConversation,
  decideOutboundCall,
  finishOutboundAttempt,
  isVoicemailGreeting,
  scheduleOutboundCall,
} from "../src/outbound";
import { makeContext } from "./fixtures";

describe("decideOutboundCall", () => {
  const base = {
    timezone: "Europe/London",
    purpose: "callback" as const,
    enabled: { callbacks: true, confirmations: true },
    doNotCall: false,
    callsToday: 0,
    dailyCap: 20,
  };
  const at = (iso: string) => new Date(iso);

  it("calls within 8am–9pm local time", () => {
    expect(decideOutboundCall({ ...base, now: at("2026-10-21T09:00:00Z") })).toEqual({
      action: "call",
    }); // 10:00 BST
  });

  it("waits until 8am, or the next morning after 9pm or once the daily limit is reached", () => {
    expect(decideOutboundCall({ ...base, now: at("2026-10-21T05:30:00Z") })).toEqual({
      action: "later",
      at: at("2026-10-21T07:00:00Z"),
      reason: "before calling hours",
    });
    expect(decideOutboundCall({ ...base, now: at("2026-10-21T20:30:00Z") })).toMatchObject({
      action: "later",
      at: at("2026-10-22T07:00:00Z"),
    });
    expect(
      decideOutboundCall({ ...base, now: at("2026-10-21T09:00:00Z"), callsToday: 20 }),
    ).toMatchObject({ action: "later", reason: "daily limit reached" });
  });

  it("never calls people who said no, when switched off, or for a cancelled booking", () => {
    const now = at("2026-10-21T09:00:00Z");
    expect(decideOutboundCall({ ...base, now, doNotCall: true }).action).toBe("cancel");
    expect(
      decideOutboundCall({ ...base, now, enabled: { callbacks: false, confirmations: true } })
        .action,
    ).toBe("cancel");
    expect(
      decideOutboundCall({ ...base, now, purpose: "confirmation", bookingStillOn: false }),
    ).toMatchObject({ action: "cancel", reason: "booking no longer active" });
  });
});

describe("isVoicemailGreeting", () => {
  it.each([
    ["Hi, you've reached Sam, please leave a message after the tone", true],
    ["The person you are calling is not available", true],
    ["Bonjour, laissez un message", true],
    ["Hello?", false],
    ["Yes, speaking", false],
  ])("%s", (text, expected) => {
    expect(isVoicemailGreeting(text)).toBe(expected);
  });
});

describe("outbound calls in the database", () => {
  let dbs: TestDbs;
  let tenantId: string;
  beforeAll(async () => {
    dbs = connectTestDbs();
    tenantId = await createTestTenant(dbs.app, "Outbound AI Co");
  });
  afterAll(async () => {
    await closeDb(dbs.app);
    await closeDb(dbs.owner);
  });

  it("claims a due call once, retries after no answer, then gives up", async () => {
    const call = await scheduleOutboundCall(dbs.app, {
      tenantId,
      purpose: "callback",
      phone: "+447700900123",
      reason: "Invoice question",
    });
    const now = new Date(Date.now() + 1000);
    const [claimed] = await claimDueOutboundCalls(dbs.app, tenantId, now);
    expect(claimed).toMatchObject({ id: call.id, status: "calling", attempts: 1 });
    expect(await claimDueOutboundCalls(dbs.app, tenantId, now)).toEqual([]);

    await finishOutboundAttempt(dbs.app, claimed!, { status: "no_answer" }, now);
    const read = async () =>
      (
        await withTenant(dbs.app, tenantId, (tx) =>
          tx.select().from(outboundCalls).where(eq(outboundCalls.id, call.id)),
        )
      )[0]!;
    expect(await read()).toMatchObject({ status: "scheduled", outcome: "no_answer" });
    expect((await read()).notBefore.getTime()).toBeGreaterThan(now.getTime());

    const later = new Date(now.getTime() + 3 * 3600 * 1000);
    const [second] = await claimDueOutboundCalls(dbs.app, tenantId, later);
    expect(second?.attempts).toBe(2);
    await finishOutboundAttempt(dbs.app, second!, { status: "voicemail" }, later);
    expect(await read()).toMatchObject({ status: "voicemail" });
  });

  it("a call held back (outside hours) doesn't use up an attempt", async () => {
    const call = await scheduleOutboundCall(dbs.app, {
      tenantId,
      purpose: "callback",
      phone: "+447700900124",
    });
    const [claimed] = await claimDueOutboundCalls(dbs.app, tenantId, new Date(Date.now() + 1000));
    const tomorrow = new Date(Date.now() + 86_400_000);
    await finishOutboundAttempt(dbs.app, claimed!, {
      status: "later",
      at: tomorrow,
      reason: "after calling hours",
    });
    const [row] = await withTenant(dbs.app, tenantId, (tx) =>
      tx.select().from(outboundCalls).where(eq(outboundCalls.id, call.id)),
    );
    expect(row).toMatchObject({ status: "scheduled", attempts: 0 });
  });

  it("opens with who's calling, that it's an AI, and why", async () => {
    const { conversationId, opening, state } = await createOutboundConversation(
      dbs.app,
      makeContext({ style: "voice" }),
      {
        tenantId,
        phone: "+447700900125",
        contactId: null,
        phoneNumberId: null,
        plan: {
          purpose: "confirmation",
          reason: null,
          booking: { reference: "OC-1", service: "check-up", when: "Thursday at 10:00" },
        },
      },
    );
    expect(opening).toMatch(
      /the AI assistant for .+\. I'm calling to confirm your check-up on Thursday at 10:00/,
    );
    expect(
      state.history.some(
        (h) => typeof h.content === "string" && h.content.includes("booking OC-1"),
      ),
    ).toBe(true);
    const [first] = await withTenant(dbs.app, tenantId, (tx) =>
      tx
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversationId)),
    );
    expect(first?.content).toBe(opening);
  });
});
