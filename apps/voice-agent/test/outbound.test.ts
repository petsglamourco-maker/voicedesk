import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseJobMetadata } from "../src/job";
import { OutboundOpener } from "../src/outbound";

function fakes() {
  const calls: string[] = [];
  return {
    calls,
    fx: {
      setHold: (on: boolean) => calls.push(`hold:${on}`),
      sayOpening: () => {
        calls.push("opening");
        return Promise.resolve();
      },
      leaveVoicemail: () => {
        calls.push("voicemail");
        return Promise.resolve();
      },
    },
  };
}

describe("OutboundOpener", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a person says hello: the opening follows at once, then the assistant is live", async () => {
    const { fx, calls } = fakes();
    const o = new OutboundOpener(fx, 3000, 4000);
    o.answered();
    o.heard("Hello?");
    await vi.advanceTimersByTimeAsync(0);
    expect(o.state).toBe("live");
    expect(calls).toEqual(["hold:true", "opening", "hold:false"]);
    await vi.advanceTimersByTimeAsync(5000); // the listen timer doesn't fire a second opening
    expect(calls.filter((c) => c === "opening")).toHaveLength(1);
  });

  it("silence: the assistant speaks first after a moment", async () => {
    const { fx, calls } = fakes();
    const o = new OutboundOpener(fx, 3000, 4000);
    o.answered();
    await vi.advanceTimersByTimeAsync(3001);
    expect(calls).toEqual(["hold:true", "opening", "hold:false"]);
  });

  it("an answering machine: waits for the beep, leaves a message, no opening", async () => {
    const { fx, calls } = fakes();
    const o = new OutboundOpener(fx, 3000, 4000);
    o.answered();
    o.heard("Hi, you've reached Sam. Please leave a message after the tone.");
    await vi.advanceTimersByTimeAsync(3999);
    expect(calls).toEqual(["hold:true"]);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toEqual(["hold:true", "voicemail"]);
    expect(o.state).toBe("voicemail");
  });
});

describe("job metadata", () => {
  it("recognises outbound calls before browser sessions", () => {
    expect(
      parseJobMetadata(
        JSON.stringify({
          kind: "outbound",
          tenantId: "t",
          conversationId: "c",
          outboundCallId: "o",
        }),
      ),
    ).toEqual({ kind: "outbound", tenantId: "t", conversationId: "c", outboundCallId: "o" });
    expect(parseJobMetadata(JSON.stringify({ tenantId: "t", conversationId: "c" }))).toEqual({
      kind: "browser",
      tenantId: "t",
      conversationId: "c",
    });
  });
});
