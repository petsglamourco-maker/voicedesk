"use client";

import { Input, Label, Select, cn } from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { SITE_NAME } from "./brand";
import { FULL_TIME_HOURS, NATIONAL_LIVING_WAGE, planYearly, receptionistCost } from "./savings";

export interface SitePlan {
  id: string;
  name: string;
  pricePence: number;
}

const pounds = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(Math.round(value));

/** The savings calculator: everything is worked out in the browser; nothing is sent. */
export function SavingsCalculator(props: { plans: SitePlan[] }) {
  const t = useTranslations("site.savings.calculator");
  const id = useId();
  const [hourly, setHourly] = useState(String(NATIONAL_LIVING_WAGE));
  const [hours, setHours] = useState(String(FULL_TIME_HOURS));
  const [planId, setPlanId] = useState(
    props.plans.find((p) => p.id === "growth")?.id ?? props.plans[0]?.id ?? "",
  );
  const [ni, setNi] = useState(true);
  const [missed, setMissed] = useState("");
  const [value, setValue] = useState("");

  const cost = receptionistCost({
    hourlyPay: Number(hourly) || 0,
    hoursPerWeek: Number(hours) || 0,
    includeNationalInsurance: ni,
  });
  const plan = props.plans.find((p) => p.id === planId);
  const ours = plan ? planYearly(plan.pricePence) : 0;
  const saving = Math.max(0, cost.total - ours);
  // A quarter of missed calls turned into bookings, over a month (4.33 weeks).
  const wonBack = ((Number(missed) || 0) * (Number(value) || 0) * 0.25 * 52) / 12;

  return (
    <div
      className="glass aurora-border relative overflow-hidden rounded-xl p-5 sm:p-7"
      data-testid="savings-calculator"
    >
      <h3 className="font-display text-xl font-semibold">{t("title")}</h3>
      <div className="mt-5 grid gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <div>
          <Label htmlFor={`${id}-hourly`}>{t("hourly")}</Label>
          <Input
            id={`${id}-hourly`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className="tabular h-11"
            value={hourly}
            onChange={(e) => setHourly(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-hours`}>{t("hours")}</Label>
          <Input
            id={`${id}-hours`}
            type="number"
            inputMode="decimal"
            min={0}
            max={80}
            step="0.5"
            className="tabular h-11"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-plan`}>{t("plan", { name: SITE_NAME })}</Label>
          <Select
            id={`${id}-plan`}
            className="h-11"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            {props.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {pounds(p.pricePence / 100)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={ni}
          onChange={(e) => setNi(e.target.checked)}
        />
        <span>
          {t("ni")}
          <span className="block text-xs text-muted-foreground">{t("niHint")}</span>
        </span>
      </label>

      <div className="mt-6 grid gap-4 sm:grid-cols-3 [&>*]:min-w-0" aria-live="polite">
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">{t("person")}</p>
          <p className="tabular mt-1 font-display text-2xl font-semibold" data-testid="person-cost">
            {pounds(cost.total)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("perYear")} · {t("perMonth", { amount: pounds(cost.perMonth) })}
          </p>
          <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between gap-2">
              <dt>{t("pay")}</dt>
              <dd className="tabular">{pounds(cost.pay)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t("nationalInsurance")}</dt>
              <dd className="tabular">{pounds(cost.nationalInsurance)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t("pension")}</dt>
              <dd className="tabular">{pounds(cost.pension)}</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">{t("ringwise", { name: SITE_NAME })}</p>
          <p className="tabular mt-1 font-display text-2xl font-semibold">{pounds(ours)}</p>
          <p className="text-xs text-muted-foreground">
            {t("perYear")} · {plan ? t("perMonth", { amount: pounds(plan.pricePence / 100) }) : ""}
          </p>
        </div>
        <div className="rounded-lg border border-primary/50 bg-primary/10 p-4 shadow-[0_0_28px_-6px_var(--color-glow)]">
          <p className="text-xs text-muted-foreground">{t("saving")}</p>
          <p
            className="tabular mt-1 font-display text-3xl font-semibold text-primary"
            data-testid="saving"
          >
            {pounds(saving)}
          </p>
          <p className="text-xs text-muted-foreground">{t("perYear")}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("notIncluded")}</p>

      <div className="mt-6 border-t border-border pt-5">
        <h4 className="font-display font-semibold">{t("missedTitle")}</h4>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div>
            <Label htmlFor={`${id}-missed`}>{t("missed")}</Label>
            <Input
              id={`${id}-missed`}
              type="number"
              inputMode="numeric"
              min={0}
              className="tabular h-11"
              value={missed}
              onChange={(e) => setMissed(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-value`}>{t("value")}</Label>
            <Input
              id={`${id}-value`}
              type="number"
              inputMode="decimal"
              min={0}
              className="tabular h-11"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        </div>
        <p
          className={cn("mt-3 text-sm", wonBack > 0 ? "text-foreground" : "text-muted-foreground")}
          aria-live="polite"
        >
          {wonBack > 0
            ? t("missedResult", { name: SITE_NAME, amount: pounds(wonBack) })
            : t("missedHint")}
        </p>
      </div>
    </div>
  );
}
