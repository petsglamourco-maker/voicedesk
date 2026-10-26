import { describe, expect, it } from "vitest";
import { cleanTopic, followUpSendAt } from "../src/followups";
import { buildSystemPrompt } from "../src/prompt";
import { InMemoryAgentServices } from "../src/services";
import { initialState, stepNote } from "../src/state";
import { runTool } from "../src/tools";
import { makeContext, PROFILE } from "./fixtures";

describe("when a follow-up is sent", () => {
  it("is 10:00 local the next day (London, summer time)", () => {
    const now = new Date("2026-07-14T15:00:00Z"); // Tuesday 16:00 BST
    expect(followUpSendAt(now, "Europe/London", null, "sms").toISOString()).toBe(
      "2026-07-15T09:00:00.000Z",
    );
  });

  it("skips days the business is closed", () => {
    const closedSunday = {
      ...PROFILE,
      openingHours: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({
        day: day as "mon",
        open: day === "sun" ? null : "09:00",
        close: day === "sun" ? null : "17:00",
        closed: day === "sun",
      })),
    };
    const saturday = new Date("2026-07-18T15:00:00Z");
    // Sunday is closed, so Monday 10:00.
    expect(followUpSendAt(saturday, "Europe/London", closedSunday, "email").toISOString()).toBe(
      "2026-07-20T09:00:00.000Z",
    );
  });

  it("WhatsApp stays inside Meta's 24-hour window", () => {
    const now = new Date("2026-07-14T08:00:00Z");
    const at = followUpSendAt(now, "Europe/London", null, "whatsapp");
    expect(at.getTime() - now.getTime()).toBeLessThanOrEqual(23 * 3_600_000);
  });

  it("topics carry no links, numbers or markup", () => {
    expect(cleanTopic("Whitening — see https://evil.example/x call 07700900123 <b>now</b>")).toBe(
      "Whitening — see call bnow/b",
    );
    expect(cleanTopic("a".repeat(100))).toHaveLength(60);
  });
});

describe("schedule_follow_up", () => {
  const ctx = makeContext({ followUps: true });

  it("needs the setting, the customer's yes, and happens once", async () => {
    const services = new InMemoryAgentServices();
    const state = initialState("en", "+447700900123");
    const off = await runTool(
      "schedule_follow_up",
      { customerAgreed: true, channel: "sms", topic: "whitening" },
      { ctx: makeContext(), services, state },
    );
    expect(off.isError).toBe(true);
    const noYes = await runTool(
      "schedule_follow_up",
      { customerAgreed: false, channel: "sms", topic: "whitening" },
      { ctx, services, state },
    );
    expect(noYes.isError).toBe(true);
    const ok = await runTool(
      "schedule_follow_up",
      { customerAgreed: true, channel: "sms", topic: "teeth whitening", name: "Sam" },
      { ctx, services, state },
    );
    expect(ok.isError).toBeFalsy();
    expect(services.followUps).toEqual([
      { channel: "sms", to: "+447700900123", topic: "teeth whitening" },
    ]);
    const again = await runTool(
      "schedule_follow_up",
      { customerAgreed: true, channel: "sms", topic: "whitening" },
      { ctx, services, state },
    );
    expect(again.isError).toBe(true);
  });

  it("not after a booking, and email needs an address", async () => {
    const services = new InMemoryAgentServices();
    const booked = initialState("en");
    booked.records.push({ type: "booking", id: "b1", reference: "TS-1" });
    expect(
      (
        await runTool(
          "schedule_follow_up",
          { customerAgreed: true, channel: "sms", to: "07700900123", topic: "x" },
          { ctx, services, state: booked },
        )
      ).isError,
    ).toBe(true);
    const noEmail = await runTool(
      "schedule_follow_up",
      { customerAgreed: true, channel: "email", topic: "x" },
      { ctx, services, state: initialState("en") },
    );
    expect(noEmail.isError).toBe(true);
  });

  it("the prompt only mentions follow-ups when the business has them on", () => {
    expect(buildSystemPrompt(makeContext({ followUps: true })).join("\n")).toContain(
      "schedule_follow_up after the customer clearly says yes",
    );
    expect(buildSystemPrompt(makeContext()).join("\n")).not.toContain("Follow-ups:");
  });
});

describe("honesty and unfinished complaints (prompt 2026-10-26.2)", () => {
  it("the prompt forbids promising contact the tools didn't confirm", () => {
    expect(buildSystemPrompt(makeContext()).join("\n")).toContain(
      "Only promise what a tool result confirms",
    );
  });

  it("a complaint started before a booking is still logged before closing", () => {
    const state = initialState("en");
    state.flow = "booking";
    state.complaint = { issue: "filling fell out" };
    expect(stepNote(state, "Mon 10:00")).toContain("call create_ticket");
    state.records.push({ type: "ticket", id: "t", reference: "TS-1" });
    expect(stepNote(state, "Mon 10:00")).not.toContain("isn't logged yet");
  });
});
