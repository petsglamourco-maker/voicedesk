import { MockLlmProvider } from "@voicedesk/adapters";
import { assistantActions, auditLog, bookings, withTenant } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

let h: TestHarness;
let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let bookingId: string;
const llm = new MockLlmProvider();

beforeAll(async () => {
  // The mock counts as "no AI configured"; present it as a switched-on provider.
  h = await createHarness({
    llm: {
      name: "test",
      available: () => Promise.resolve(true),
      complete: (r) => llm.complete(r),
      stream: (r, onText) => llm.stream(r, onText),
    },
  });
  biz = await createOwnerWithTenant(h, "Ask Co");
  const [b] = await withTenant(h.db, biz.tenantId, (tx) =>
    tx
      .insert(bookings)
      .values({
        tenantId: biz.tenantId,
        reference: "AK-1",
        service: "Consultation",
        customerName: "Robin",
        startsAt: new Date(Date.now() + 3 * 86_400_000),
        endsAt: new Date(Date.now() + 3 * 86_400_000 + 1_800_000),
      })
      .returning(),
  );
  bookingId = b!.id;
});
afterAll(() => h.close());

const headers = () => ({ cookie: biz.cookie, origin: ORIGIN });
const url = (path: string) => `/api/tenants/${biz.tenantId}/assistant${path}`;

describe("Ask VoiceDesk", () => {
  it("proposes; approving carries it out once; nothing happens before approval", async () => {
    llm.enqueue(
      MockLlmProvider.toolUse("propose_cancel_booking", { bookingId, reason: "Closed that day" }),
      MockLlmProvider.text("I've prepared that cancellation. Approve it below."),
    );
    const ask = await h.app.inject({
      method: "POST",
      url: url("/ask"),
      headers: headers(),
      payload: { question: "Cancel Robin's consultation" },
    });
    expect(ask.statusCode).toBe(200);
    const body = ask.json<{ answer: string; actions: Array<{ id: string; status: string }> }>();
    expect(body.answer).toContain("Approve it below");
    expect(body.actions).toEqual([expect.objectContaining({ status: "pending" })]);
    const read = async () =>
      (
        await withTenant(h.db, biz.tenantId, (tx) =>
          tx.select().from(bookings).where(eq(bookings.id, bookingId)),
        )
      )[0]!.status;
    expect(await read()).toBe("confirmed");

    const id = body.actions[0]!.id;
    const approve = await h.app.inject({
      method: "POST",
      url: url(`/actions/${id}/approve`),
      headers: headers(),
      payload: {},
    });
    expect(approve.json()).toMatchObject({ status: "done" });
    expect(await read()).toBe("cancelled");
    // The customer is told, through the normal booking notifications.
    expect(h.jobs.notifications).toContainEqual(
      expect.objectContaining({ kind: "booking.changed", bookingId, change: "cancelled" }),
    );

    const twice = await h.app.inject({
      method: "POST",
      url: url(`/actions/${id}/approve`),
      headers: headers(),
      payload: {},
    });
    expect(twice.statusCode).toBe(409);
  });

  it("doesn't propose cancelling a booking that is already cancelled", async () => {
    llm.enqueue(
      MockLlmProvider.toolUse("propose_cancel_booking", { bookingId }),
      MockLlmProvider.text("Prepared."),
    );
    const ask = await h.app.inject({
      method: "POST",
      url: url("/ask"),
      headers: headers(),
      payload: { question: "Cancel it again" },
    });
    // Already cancelled: nothing to propose.
    expect(ask.json<{ actions: unknown[] }>().actions).toEqual([]);

    const list = await h.app.inject({ method: "GET", url: url("/actions"), headers: headers() });
    expect(list.json<{ actions: Array<{ status: string }> }>().actions[0]).toMatchObject({
      status: "done",
    });
  });
});

describe("approvals (audit M9)", () => {
  async function propose(createdAt = new Date()) {
    const [row] = await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .insert(assistantActions)
        .values({
          tenantId: biz.tenantId,
          kind: "cancel_booking",
          payload: { bookingId },
          summary: "Cancel AK-1",
          createdAt,
        })
        .returning(),
    );
    return row!.id;
  }

  it("expire after a day", async () => {
    const id = await propose(new Date(Date.now() - 25 * 60 * 60 * 1000));
    const res = await h.app.inject({
      method: "POST",
      url: url(`/actions/${id}/approve`),
      headers: headers(),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "EXPIRED" });
  });

  it("record a fingerprint of what was approved, and the IP", async () => {
    const [row] = await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.tenantId, biz.tenantId),
            eq(auditLog.action, "assistant.action_approved"),
          ),
        ),
    );
    const meta = row?.metadata as { kind?: string; proposal?: string } | undefined;
    expect(meta?.kind).toBe("cancel_booking");
    expect(meta?.proposal).toMatch(/^[0-9a-f]{16}$/);
    expect(row?.ipAddress).toBeTruthy();
  });

  it("can only be rejected by whoever asked or someone allowed to do it", async () => {
    const id = await propose();
    // A rejection by the owner (allowed to cancel bookings) works and is audited.
    const res = await h.app.inject({
      method: "POST",
      url: url(`/actions/${id}/reject`),
      headers: headers(),
    });
    expect(res.json()).toMatchObject({ status: "rejected" });
    const rows = await withTenant(h.db, biz.tenantId, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "assistant.action_rejected"), eq(auditLog.targetId, id))),
    );
    expect(rows).toHaveLength(1);
  });
});
