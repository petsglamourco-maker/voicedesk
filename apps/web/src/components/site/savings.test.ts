import { describe, expect, it } from "vitest";
import { NATIONAL_LIVING_WAGE, planYearly, receptionistCost } from "./savings";

describe("receptionistCost", () => {
  it("full time at the National Living Wage costs about £28.3k a year with NI and pension", () => {
    const cost = receptionistCost({
      hourlyPay: NATIONAL_LIVING_WAGE,
      hoursPerWeek: 37.5,
      includeNationalInsurance: true,
    });
    expect(cost.pay).toBeCloseTo(24_784.5, 1);
    expect(cost.nationalInsurance).toBeCloseTo((24_784.5 - 5_000) * 0.15, 1);
    expect(cost.pension).toBeCloseTo((24_784.5 - 6_240) * 0.03, 1);
    expect(Math.round(cost.total)).toBe(28_309);
    expect(Math.round(cost.perMonth)).toBe(2_359);
  });

  it("leaves out NI when the Employment Allowance covers it", () => {
    const cost = receptionistCost({
      hourlyPay: 12.71,
      hoursPerWeek: 37.5,
      includeNationalInsurance: false,
    });
    expect(cost.nationalInsurance).toBe(0);
    expect(Math.round(cost.total)).toBe(25_341);
  });

  it("charges nothing below the thresholds, and never goes negative", () => {
    const small = receptionistCost({
      hourlyPay: 12,
      hoursPerWeek: 5,
      includeNationalInsurance: true,
    });
    expect(small.nationalInsurance).toBe(0);
    expect(small.pension).toBe(0);
    expect(
      receptionistCost({ hourlyPay: -3, hoursPerWeek: 10, includeNationalInsurance: true }).total,
    ).toBe(0);
  });
});

describe("planYearly", () => {
  it("turns monthly pence into yearly pounds", () => {
    expect(planYearly(7_900)).toBe(948);
  });
});
