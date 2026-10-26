/**
 * What a receptionist costs a UK employer, for the website's savings calculator (ADR 0030).
 * Estimates from public 2026/27 rates; the page shows the sources. Pure, so it's unit tested.
 */

/** National Living Wage for workers aged 21+, from 1 April 2026 (GOV.UK). */
export const NATIONAL_LIVING_WAGE = 12.71;
/** Employer Class 1 National Insurance 2026/27 (HMRC): 15% above £5,000 a year. */
export const EMPLOYER_NI_RATE = 0.15;
export const EMPLOYER_NI_THRESHOLD = 5_000;
/** Auto-enrolment minimum employer pension: 3% of qualifying earnings (£6,240–£50,270). */
export const PENSION_RATE = 0.03;
export const PENSION_LOWER = 6_240;
export const PENSION_UPPER = 50_270;
export const FULL_TIME_HOURS = 37.5;
/** Hours in a week: the assistant answers all of them. */
export const HOURS_IN_WEEK = 168;

export interface ReceptionistCost {
  pay: number;
  nationalInsurance: number;
  pension: number;
  total: number;
  perMonth: number;
}

/** Yearly cost in pounds of employing one receptionist (before recruitment and cover). */
export function receptionistCost(params: {
  hourlyPay: number;
  hoursPerWeek: number;
  /** Small employers may have it covered by the Employment Allowance. */
  includeNationalInsurance: boolean;
}): ReceptionistCost {
  const hourly = Math.max(0, params.hourlyPay);
  const hours = Math.min(Math.max(0, params.hoursPerWeek), 80);
  const pay = hourly * hours * 52;
  const nationalInsurance = params.includeNationalInsurance
    ? Math.max(0, pay - EMPLOYER_NI_THRESHOLD) * EMPLOYER_NI_RATE
    : 0;
  const pension = Math.max(0, Math.min(pay, PENSION_UPPER) - PENSION_LOWER) * PENSION_RATE;
  const total = pay + nationalInsurance + pension;
  return { pay, nationalInsurance, pension, total, perMonth: total / 12 };
}

/** A plan's yearly price in pounds (prices are monthly, in pence, excluding VAT). */
export function planYearly(pricePence: number): number {
  return (pricePence * 12) / 100;
}
