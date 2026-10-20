import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandoffController, type HandoffEffects } from "../src/handoff";

function fakes(overrides: Partial<HandoffEffects> = {}) {
  const calls: string[] = [];
  const statuses = new Map<string, string>();
  const fx: HandoffEffects = {
    open: () => {
      calls.push("open");
      statuses.set("h1", "waiting");
      return Promise.resolve("h1");
    },
    markMissed: (id) => {
      const missed = statuses.get(id) === "waiting";
      if (missed) statuses.set(id, "missed");
      calls.push(`missed:${missed}`);
      return Promise.resolve(missed);
    },
    statusOf: (id) => Promise.resolve(statuses.get(id) ?? null),
    markEnded: (id) => {
      statuses.set(id, "ended");
      calls.push("markEnded");
      return Promise.resolve();
    },
    markReturned: (id) => {
      statuses.set(id, "returned");
      calls.push("markReturned");
      return Promise.resolve();
    },
    sayStillConnecting: () => calls.push("say:stillConnecting"),
    sayThroughTo: (name) => calls.push(`say:throughTo:${name}`),
    sayNobodyFree: () => calls.push("say:nobodyFree"),
    sayBackWithAssistant: () => calls.push("say:back"),
    transferToPhone: (n) => {
      calls.push(`transfer:${n}`);
      return Promise.resolve();
    },
    note: (text) => calls.push(`note:${text.slice(0, 20)}`),
    hangUp: (reason) => {
      calls.push(`hangUp:${reason}`);
      return Promise.resolve();
    },
    setHumanActive: (on) => calls.push(`human:${on}`),
    log: () => undefined,
    ...overrides,
  };
  return { fx, calls, statuses };
}

describe("HandoffController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rings, holds the caller, then connects the person who answers", async () => {
    const { fx, calls, statuses } = fakes();
    const c = new HandoffController(fx, 30_000, 10_000);
    await c.start({ reason: "billing", urgent: false });
    expect(c.state).toBe("ringing");
    await vi.advanceTimersByTimeAsync(21_000);
    expect(calls.filter((x) => x === "say:stillConnecting")).toHaveLength(2);

    statuses.set("h1", "answered");
    c.personJoined("Sam");
    expect(c.state).toBe("connected");
    await vi.advanceTimersByTimeAsync(60_000); // no more hold messages, no timeout
    expect(calls).toEqual([
      "human:true",
      "open",
      "say:stillConnecting",
      "say:stillConnecting",
      "say:throughTo:Sam",
    ]);
  });

  it("hands back to the assistant when the person chooses to", async () => {
    const { fx, calls, statuses } = fakes();
    const c = new HandoffController(fx, 30_000);
    await c.start({ reason: null, urgent: false });
    c.personJoined("Sam");
    statuses.set("h1", "returned");
    await c.personLeft();
    expect(c.state).toBe("idle");
    expect(calls.slice(-3)).toEqual(["note:A member of the team", "human:false", "say:back"]);
  });

  it("ends the call when the person hung up", async () => {
    const { fx, calls, statuses } = fakes();
    const c = new HandoffController(fx, 30_000);
    await c.start({ reason: null, urgent: false });
    c.personJoined("Sam");
    statuses.set("h1", "ended");
    await c.personLeft();
    expect(calls.at(-1)).toBe("hangUp:ended by the person who answered");
    expect(calls).not.toContain("say:back");
  });

  it("a dropped person (closed tab) returns the caller to the assistant", async () => {
    const { fx, calls, statuses } = fakes();
    const c = new HandoffController(fx, 30_000);
    await c.start({ reason: null, urgent: false });
    statuses.set("h1", "answered");
    c.personJoined("Sam");
    await c.personLeft();
    expect(calls).toContain("markReturned");
    expect(calls).toContain("note:The call with the me");
    expect(calls.at(-1)).toBe("say:back");
  });

  it("nobody answers: falls back to the phone line", async () => {
    const { fx, calls } = fakes();
    const c = new HandoffController(fx, 30_000, 100_000);
    await c.start({ reason: null, urgent: false, fallback: "+447700900111" });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(calls.slice(-3)).toEqual(["missed:true", "human:false", "transfer:+447700900111"]);
    expect(c.state).toBe("idle");
  });

  it("nobody answers and no phone line: the assistant offers a message", async () => {
    const { fx, calls } = fakes();
    const c = new HandoffController(fx, 30_000, 100_000);
    await c.start({ reason: null, urgent: false });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(calls.slice(-3)).toEqual(["note:Nobody at the busine", "human:false", "say:nobodyFree"]);
  });

  it("an answer racing the timeout wins (the timeout does nothing)", async () => {
    const { fx, calls, statuses } = fakes();
    const c = new HandoffController(fx, 30_000, 100_000);
    await c.start({ reason: null, urgent: false });
    statuses.set("h1", "answered"); // claimed in the API just before the timer fired
    await vi.advanceTimersByTimeAsync(30_001);
    expect(calls).toContain("missed:false");
    expect(calls).not.toContain("say:nobodyFree");
    expect(c.state).toBe("ringing"); // the person's browser is about to join
    c.personJoined("Sam");
    expect(c.state).toBe("connected");
  });

  it("the caller hanging up mid-conversation closes the handoff", async () => {
    const { fx, calls } = fakes();
    const c = new HandoffController(fx, 30_000);
    await c.start({ reason: null, urgent: false });
    c.personJoined("Sam");
    await c.callEnded();
    expect(calls.at(-1)).toBe("markEnded");
  });

  it("the caller hanging up while it rings marks it missed", async () => {
    const { fx, calls } = fakes();
    const c = new HandoffController(fx, 30_000);
    await c.start({ reason: null, urgent: false });
    await c.callEnded();
    expect(calls).toContain("missed:true");
  });
});
