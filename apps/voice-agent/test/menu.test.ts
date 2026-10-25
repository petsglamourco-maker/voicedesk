import { describe, expect, it } from "vitest";
import { callerFromSip, forwardedFromSip } from "../src/job";
import { SilenceHandler } from "../src/silence";

describe("forwarded calls (missed by the team)", () => {
  it("are detected from the forwarding headers the trunk maps to attributes", () => {
    expect(forwardedFromSip({ "sip.phoneNumber": "+447700900123" })).toBe(false);
    expect(
      forwardedFromSip({ "vd.diversion": "<sip:+442382721976@carrier>;reason=no-answer" }),
    ).toBe(true);
    expect(forwardedFromSip({ "vd.forwardedFrom": "+442382721976" })).toBe(true);
    expect(forwardedFromSip({ "vd.forwardedFrom": "  " })).toBe(false);
    // The caller is still the person who rang, not the forwarding line.
    expect(callerFromSip({ "sip.phoneNumber": "+447700900123" }).callerPhone).toBe("+447700900123");
  });
});

describe("silence after the menu", () => {
  it("repeats the menu once before the usual check-in and goodbye", async () => {
    const said: string[] = [];
    let chosen = false;
    const s = new SilenceHandler({
      menuPending: () => !chosen,
      repeatMenu: () => Promise.resolve(said.push("menu")),
      stillThere: () => Promise.resolve(said.push("still there?")),
      goodbye: () => Promise.resolve(said.push("goodbye")),
    });
    await s.onUserState("away");
    await s.onUserState("away");
    await s.onUserState("away");
    expect(said).toEqual(["menu", "still there?", "goodbye"]);
  });

  it("doesn't repeat it once a department was chosen", async () => {
    const said: string[] = [];
    const s = new SilenceHandler({
      menuPending: () => false,
      repeatMenu: () => Promise.resolve(said.push("menu")),
      stillThere: () => Promise.resolve(said.push("still there?")),
      goodbye: () => Promise.resolve(said.push("goodbye")),
    });
    await s.onUserState("away");
    expect(said).toEqual(["still there?"]);
  });
});
