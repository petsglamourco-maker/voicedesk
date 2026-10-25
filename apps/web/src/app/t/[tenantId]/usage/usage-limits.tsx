"use client";

import { Alert, Button, Card, CardHead, Field, Input, Progress, StatusPill } from "@voicedesk/ui";
import { Gauge } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { SpendCategory, SpendView } from "@/lib/api";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

const CATEGORIES: SpendCategory[] = ["ai", "sms", "calls"];

/** This month's spend per category and the business's own monthly caps (ADR 0022). */
export function UsageLimits(props: { tenantId: string; initial: SpendView }) {
  const t = useTranslations("usage");
  const common = useTranslations("common");
  const format = useFormatter();
  const [view, setView] = useState(props.initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const money = (pence: number) =>
    format.number(pence / 100, { style: "currency", currency: "GBP" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Partial<Record<SpendCategory, number>> = {};
    for (const c of CATEGORIES) {
      const pounds = Number(formString(form, c));
      if (!Number.isFinite(pounds) || pounds < 0) return setError(t("invalidAmount"));
      body[c] = Math.round(pounds * 100);
    }
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      setView(
        await api<SpendView>(`/api/tenants/${props.tenantId}/spend`, {
          method: "PUT",
          body: JSON.stringify(body),
        }),
      );
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {view.suspended ? <Alert tone="error">{t("suspended")}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-3" data-testid="usage-cards">
        {CATEGORIES.map((c) => {
          const { spent, cap, state } = view.categories[c];
          return (
            <Card key={c}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold">{t(`categories.${c}`)}</h2>
                <StatusPill
                  tone={
                    state === "reached" ? "danger" : state === "warning" ? "warning" : "success"
                  }
                  label={t(`states.${state}`)}
                />
              </div>
              <p className="mt-3 font-display text-2xl font-semibold tabular-nums">
                {money(spent)}
                <span className="ms-1 text-sm font-normal text-muted-foreground">
                  {t("ofCap", { cap: money(cap) })}
                </span>
              </p>
              <Progress
                className="mt-3"
                value={spent}
                max={Math.max(cap, 1)}
                label={t("progressLabel", { what: t(`categories.${c}`) })}
              />
              <p className="mt-3 text-xs text-muted-foreground">{t(`effects.${c}`)}</p>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHead
          icon={<Gauge />}
          title={view.businessCaps ? t("capsTitle") : t("allowanceTitle")}
          hint={view.businessCaps ? t("capsHint") : t("allowanceHint")}
        />
        {error ? (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        ) : null}
        {saved ? (
          <Alert tone="success" className="mt-4">
            {t("saved")}
          </Alert>
        ) : null}
        {view.canEdit ? (
          <form
            method="post"
            onSubmit={(e) => void onSubmit(e)}
            className="mt-5 grid gap-4 sm:grid-cols-3"
          >
            {CATEGORIES.map((c) => (
              <Field
                key={c}
                id={`cap-${c}`}
                label={t("capLabel", { what: t(`categories.${c}`) })}
                hint={t("upTo", { max: money(view.allowance[c]) })}
              >
                <Input
                  id={`cap-${c}`}
                  name={c}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={view.allowance[c] / 100}
                  step="0.01"
                  defaultValue={(view.caps[c] / 100).toFixed(2)}
                  required
                />
              </Field>
            ))}
            <div className="sm:col-span-3">
              <Button type="submit" disabled={pending}>
                {pending ? common("working") : t("save")}
              </Button>
            </div>
          </form>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {view.businessCaps ? t("ownersOnly") : t("planOnly")}
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">{t("estimateNote")}</p>
      </Card>
    </div>
  );
}
