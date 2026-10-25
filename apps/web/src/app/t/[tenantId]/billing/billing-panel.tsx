"use client";

import { Alert, Button, Card, CardHead, StatusPill, cn } from "@voicedesk/ui";
import { Check, CreditCard, Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import type { BillingPlan, BillingView } from "@/lib/api";
import { api } from "@/lib/client-api";

const FEATURES = ["whatsapp", "va_console", "feedback", "daily_brief", "ai_calls"] as const;

/** The business's plan, its status and the plans to move to (ADR 0023). */
export function BillingPanel(props: {
  tenantId: string;
  view: BillingView;
  checkout: "done" | "cancelled" | null;
}) {
  const t = useTranslations("billing");
  const common = useTranslations("common");
  const format = useFormatter();
  const { view } = props;
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pounds = (pence: number) =>
    format.number(pence / 100, {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: pence % 100 === 0 ? 0 : 2,
    });
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long" });
  const subscribed = view.hasBillingAccount && view.status !== "canceled";

  async function go(path: "checkout" | "portal", planId?: string) {
    setPending(planId ?? path);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`/api/tenants/${props.tenantId}/billing/${path}`, {
        method: "POST",
        ...(planId ? { body: JSON.stringify({ planId }) } : {}),
      });
      // Stripe's own page; only https Stripe (or the local mock) addresses are opened.
      if (!/^https:\/\//.test(url)) throw new Error(common("errorGeneric"));
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
      setPending(null);
    }
  }

  const statusLine = (() => {
    if (view.reason === "trial_ended") return t("status.trialEnded");
    if (view.reason === "canceled") return t("status.canceled");
    if (view.reason === "unpaid") return t("status.unpaid");
    if (view.status === "trialing" && view.trialEndsAt) {
      return t("status.trial", { days: view.trialDaysLeft ?? 0, date: date(view.trialEndsAt) });
    }
    if (view.status === "past_due") return t("status.pastDue");
    if (view.comped) return t("status.comped");
    if (view.cancelAtPeriodEnd && view.currentPeriodEnd) {
      return t("status.endsOn", { date: date(view.currentPeriodEnd) });
    }
    if (view.currentPeriodEnd) return t("status.renews", { date: date(view.currentPeriodEnd) });
    return t("status.active");
  })();

  return (
    <div className="space-y-6">
      {props.checkout === "done" ? (
        <Alert tone="success" data-testid="checkout-done">
          {t("checkoutDone")}
        </Alert>
      ) : props.checkout === "cancelled" ? (
        <Alert tone="info">{t("checkoutCancelled")}</Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {view.canManage && !view.billingReady ? (
        <Alert tone="info" data-testid="billing-not-ready">
          {t("notReady")}
        </Alert>
      ) : null}

      <Card data-testid="current-plan">
        <CardHead
          icon={<CreditCard />}
          title={t("currentTitle", { plan: view.plan.name })}
          hint={statusLine}
          aside={
            <StatusPill
              tone={
                !view.usable
                  ? "danger"
                  : view.status === "past_due"
                    ? "warning"
                    : view.status === "trialing"
                      ? "info"
                      : "success"
              }
              label={t(`pill.${view.usable ? view.status : "stopped"}`)}
            />
          }
        />
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
          <Allowance label={t("allowance.minutes")} value={format.number(view.plan.minutes)} />
          <Allowance label={t("allowance.texts")} value={format.number(view.plan.texts)} />
          <Allowance label={t("allowance.ai")} value={pounds(view.plan.aiPence)} />
        </dl>
        {view.canManage && view.hasBillingAccount ? (
          <div className="mt-5">
            <Button
              variant="secondary"
              disabled={pending !== null}
              onClick={() => void go("portal")}
              data-testid="manage-billing"
            >
              {pending === "portal" ? common("working") : t("manage")}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">{t("manageHint")}</p>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3" data-testid="plan-cards">
        {view.plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            current={plan.id === view.plan.id && view.status !== "canceled"}
            highlight={plan.id === "growth"}
            pounds={pounds}
            action={
              !view.canManage ? null : plan.id === view.plan.id &&
                view.usable ? null : subscribed ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={pending !== null}
                  onClick={() => void go("portal")}
                >
                  {t("changeInPortal")}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  variant={plan.id === "growth" ? "primary" : "secondary"}
                  disabled={pending !== null || !plan.available}
                  onClick={() => void go("checkout", plan.id)}
                  data-testid={`choose-${plan.id}`}
                >
                  {pending === plan.id ? common("working") : t("choose", { plan: plan.name })}
                </Button>
              )
            }
          />
        ))}
      </div>
      {!view.canManage ? <p className="text-sm text-muted-foreground">{t("ownersOnly")}</p> : null}
      <p className="text-xs text-muted-foreground">{t("vatNote")}</p>
    </div>
  );
}

function PlanCard(p: {
  plan: BillingPlan;
  current: boolean;
  highlight: boolean;
  pounds: (pence: number) => string;
  action: ReactNode;
}) {
  const t = useTranslations("billing");
  return (
    <Card
      className={cn("flex flex-col", p.highlight && "ring-1 ring-primary/50")}
      data-testid={`plan-${p.plan.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">{p.plan.name}</h2>
        {p.current ? (
          <StatusPill tone="success" label={t("current")} />
        ) : p.highlight ? (
          <StatusPill tone="primary" icon={Sparkles} label={t("popular")} />
        ) : null}
      </div>
      <p className="mt-2 font-display text-3xl font-semibold tabular-nums">
        {p.pounds(p.plan.pricePence)}
        <span className="ms-1 text-sm font-normal text-muted-foreground">{t("perMonth")}</span>
      </p>
      <ul className="mt-4 flex-1 space-y-2 text-sm">
        <Line>{t("lines.minutes", { n: p.plan.minutes })}</Line>
        <Line>{t("lines.texts", { n: p.plan.texts })}</Line>
        <Line>{t("lines.ai", { amount: p.pounds(p.plan.aiPence) })}</Line>
        <Line>{t("lines.numbers", { n: p.plan.phoneNumbers })}</Line>
        <Line>{t("lines.seats", { n: p.plan.seats })}</Line>
        <Line>{t("lines.basics")}</Line>
        {FEATURES.map((f) =>
          p.plan.features.includes(f) ? <Line key={f}>{t(`features.${f}`)}</Line> : null,
        )}
      </ul>
      {p.action ? <div className="mt-5">{p.action}</div> : null}
    </Card>
  );
}

function Line(props: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      <span>{props.children}</span>
    </li>
  );
}

function Allowance(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold tabular-nums">{props.value}</dd>
    </div>
  );
}
