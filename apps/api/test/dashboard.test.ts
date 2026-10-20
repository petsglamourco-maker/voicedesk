import { createConversation, loadAgentContext } from "@voicedesk/agent-brain";
import { bookings, conversations, withTenant } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bucketKeys } from "../src/routes/dashboard";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

describe("bucketKeys", () => {
  it("days, Monday-based weeks and months, oldest first, ending now", () => {
    const daily = bucketKeys("daily", "2026-10-21");
    expect(daily).toHaveLength(14);
    expect(daily.at(-1)).toBe("2026-10-21");
    expect(daily[0]).toBe("2026-10-08");
    const weekly = bucketKeys("weekly", "2026-10-21"); // a Wednesday
    expect(weekly.at(-1)).toBe("2026-10-19");
    expect(weekly.at(-2)).toBe("2026-10-12");
    const monthly = bucketKeys("monthly", "2026-10-21");
    expect(monthly.at(-1)).toBe("2026-10-01");
    expect(monthly[0]).toBe("2025-11-01");
  });
});

describe("dashboard", () => {
  let h: TestHarness;
  let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;
  beforeAll(async () => {
    h = await createHarness();
    biz = await createOwnerWithTenant(h, "Dash Co");
    const voiceCtx = await loadAgentContext(h.db, biz.tenantId, "voice");
    const chatCtx = await loadAgentContext(h.db, biz.tenantId, "chat");
    for (const channel of ["voice", "voice", "whatsapp", "web_chat"] as const) {
      const ctx = channel === "voice" ? voiceCtx : chatCtx;
      const { conversationId } = await createConversation(h.db, ctx, {
        tenantId: biz.tenantId,
        channel,
      });
      await withTenant(h.db, biz.tenantId, (tx) =>
        tx
          .update(conversations)
          .set({
            summary: { intent: channel === "voice" ? "booking" : "enquiry", sentiment: "positive" },
          })
          .where(eq(conversations.id, conversationId)),
      );
    }
    // Test-console chats never count.
    await createConversation(h.db, chatCtx, { tenantId: biz.tenantId, channel: "test_console" });
    await withTenant(h.db, biz.tenantId, (tx) =>
      tx.insert(bookings).values({
        tenantId: biz.tenantId,
        reference: "DB-1",
        service: "Check-up",
        customerName: "Sam",
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000 + 1_800_000),
      }),
    );
  });
  afterAll(() => h.close());

  it("counts every touchpoint per day, with totals, mix, intents and the heatmap", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${biz.tenantId}/dashboard?view=daily`,
      headers: { cookie: biz.cookie, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json<{
      buckets: string[];
      touchpoints: Record<string, number[]>;
      series: { conversations: number[]; bookings: number[] };
      kpis: { conversations: { value: number }; bookings: { value: number } };
      channelMix: Record<string, number>;
      intents: Array<{ intent: string; count: number }>;
      sentiment: Record<string, number>;
      heatmap: number[][];
    }>();
    expect(d.buckets).toHaveLength(14);
    expect(d.series.conversations.at(-1)).toBe(4);
    expect(d.touchpoints.voice!.at(-1)).toBe(2);
    expect(d.kpis.conversations.value).toBe(4);
    expect(d.kpis.bookings.value).toBe(1);
    expect(d.channelMix).toMatchObject({ voice: 2, whatsapp: 1, web_chat: 1, email: 0 });
    expect(d.intents[0]).toEqual({ intent: "booking", count: 2 });
    expect(d.sentiment).toEqual({ positive: 4 });
    expect(d.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(4);

    for (const view of ["weekly", "monthly"]) {
      const other = await h.app.inject({
        method: "GET",
        url: `/api/tenants/${biz.tenantId}/dashboard?view=${view}`,
        headers: { cookie: biz.cookie, origin: ORIGIN },
      });
      expect(
        other.json<{ kpis: { conversations: { value: number } } }>().kpis.conversations.value,
      ).toBe(4);
    }
  });
});
