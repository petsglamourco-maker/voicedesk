import { describe, expect, it } from "vitest";
import { checkDestination, countryOfNumber } from "../src/destinations";
import { groupDigitsForReadback, normalisePhone } from "../src/util";

const ALL = ["GB", "IE", "US", "CA", "AU", "NZ"];

describe("phone numbers in every country pack (ADR 0031)", () => {
  it.each([
    ["07700 900123", "GB", "+447700900123"],
    ["020 7946 0958", "GB", "+442079460958"],
    ["087 123 4567", "IE", "+353871234567"],
    ["(212) 555-0142", "US", "+12125550142"],
    ["416-555-0199", "CA", "+14165550199"],
    ["0412 345 678", "AU", "+61412345678"],
    ["021 123 4567", "NZ", "+64211234567"],
    ["+44 7700 900123", "US", "+447700900123"],
    ["0044 7700 900123", "GB", "+447700900123"],
  ])("%s in %s → %s", (raw, country, e164) => {
    expect(normalisePhone(raw, country)).toBe(e164);
  });

  it("rejects what can't be a phone number", () => {
    expect(normalisePhone("12", "GB")).toBeNull();
    expect(normalisePhone("call me", "US")).toBeNull();
  });

  it("splits +1 into the US, Canada and the Caribbean", () => {
    expect(countryOfNumber("+12125550142")).toBe("US");
    expect(countryOfNumber("+14165550199")).toBe("CA");
    expect(countryOfNumber("+18765550123")).toBe("JM");
    expect(countryOfNumber("+447624123456")).toBe("GB"); // Isle of Man counts as the UK
    expect(countryOfNumber("+447700900111")).toBe("GB"); // Ofcom drama range: still the UK
    expect(countryOfNumber("+15550100000")).toBeNull(); // unknown +1: never guessed
  });

  it("blocks premium and special-rate numbers in each country", () => {
    for (const number of [
      "+449098790000", // UK premium
      "+448712345678", // UK shared cost
      "+447012345678", // UK personal number
      "+19005550123", // US pay-per-call
      "+611900123456", // AU premium
      "+64900123456", // NZ premium
      "+353151234567", // IE premium
    ]) {
      expect(checkDestination(number, ALL), number).toEqual({ ok: false, reason: "premium" });
    }
    expect(checkDestination("+447624123456", ALL)).toEqual({ ok: true }); // Isle of Man mobile
    expect(checkDestination("+443001234567", ALL)).toEqual({ ok: true }); // UK 03 business line
    expect(checkDestination("+12125550142", ALL)).toEqual({ ok: true });
    expect(checkDestination("+61412345678", ALL)).toEqual({ ok: true });
  });

  it("only allowed countries, and never the Caribbean by accident", () => {
    expect(checkDestination("+12125550142", ["GB"])).toEqual({ ok: false, reason: "country" });
    expect(checkDestination("+18765550123", ["US"])).toEqual({ ok: false, reason: "country" });
  });

  it("reads numbers back the way people say them", () => {
    expect(groupDigitsForReadback("+447700900123", "GB")).toBe("07700 900 123");
    expect(groupDigitsForReadback("+12125550142", "US")).toBe("(212) 555-0142");
    expect(groupDigitsForReadback("+447700900123", "US")).toBe("+44 7700 900 123");
  });
});
