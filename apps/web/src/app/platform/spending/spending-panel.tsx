"use client";

import {
  Alert,
  Button,
  Card,
  CardHead,
  Checkbox,
  Field,
  Input,
  StatusPill,
  Switch,
  useConfirm,
} from "@voicedesk/ui";
import { Calculator, Globe2, PauseCircle, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { SpendCategory, SpendView } from "@/lib/api";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

type Pence = Record<SpendCategory, number>;
interface Settings {
  maxCapPence: Pence;
  costs: {
    voicePencePerMinute: number;
    phoneInboundPencePerMinute: number;
    phoneOutboundPencePerMinute: number;
    smsPencePerSegment: number;
    usdToGbp: number;
  };
  paused: { outboundCalls: boolean; sms: boolean; ai: boolean };
  allowedCountries: string[];
}
export interface PlatformSpending {
  settings: Settings;
  businesses: Array<{
    tenantId: string;
    name: string;
    status: "onboarding" | "active" | "suspended";
    spend: Pick<SpendView, "month" | "categories">;
  }>;
}

const CATEGORIES: SpendCategory[] = ["ai", "sms", "calls"];
const COUNTRIES = ["GB", "IE", "FR", "DE", "ES", "US"] as const;
const COSTS = [
  "voicePencePerMinute",
  "phoneInboundPencePerMinute",
  "phoneOutboundPencePerMinute",
  "smsPencePerSegment",
  "usdToGbp",
] as const;

export function SpendingPanel(props: { initial: PlatformSpending }) {
  const t = useTranslations("spending");
  const usage = useTranslations("usage");
  const common = useTranslations("common");
  const format = useFormatter();
  const confirm = useConfirm();
  const [data, setData] = useState(props.initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const money = (pence: number) =>
    format.number(pence / 100, { style: "currency", currency: "GBP" });

  async function save(patch: Partial<Settings>, message: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ settings: Settings }>("/api/platform/spend-settings", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setData((d) => ({ ...d, settings: res.settings }));
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  async function togglePause(key: keyof Settings["paused"], on: boolean) {
    if (on && !(await confirm({ title: t(`pause.${key}Confirm`), destructive: true }))) return;
    await save({ paused: { ...data.settings.paused, [key]: on } }, t("saved"));
  }

  async function setStatus(tenantId: string, name: string, status: "active" | "suspended") {
    const ok = await confirm({
      title: status === "suspended" ? t("suspendConfirm", { name }) : t("resumeConfirm", { name }),
      destructive: status === "suspended",
    });
    if (!ok) return;
    setPending(true);
    setError(null);
    try {
      await api(`/api/platform/businesses/${tenantId}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      setData((d) => ({
        ...d,
        businesses: d.businesses.map((b) => (b.tenantId === tenantId ? { ...b, status } : b)),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  function onLimits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const maxCapPence = Object.fromEntries(
      CATEGORIES.map((c) => [c, Math.round(Number(formString(form, `max-${c}`)) * 100)]),
    ) as Pence;
    const costs = Object.fromEntries(
      COSTS.map((k) => [k, Number(formString(form, k))]),
    ) as Settings["costs"];
    const allowedCountries = COUNTRIES.filter((c) => form.get(`country-${c}`) === "on");
    if (allowedCountries.length === 0) return setError(t("countryNeeded"));
    void save({ maxCapPence, costs, allowedCountries }, t("saved"));
  }

  return (
    <div className="space-y-6">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <CardHead icon={<PauseCircle />} title={t("pause.title")} hint={t("pause.hint")} />
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {(["outboundCalls", "sms", "ai"] as const).map((key) => (
            <label key={key} className="flex items-start gap-3">
              <Switch
                className="mt-0.5"
                checked={data.settings.paused[key]}
                disabled={pending}
                aria-label={t(`pause.${key}`)}
                onCheckedChange={(on) => void togglePause(key, on)}
              />
              <span>
                <span className="block text-sm font-semibold">{t(`pause.${key}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`pause.${key}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <CardHead icon={<Users />} title={t("businessesTitle")} hint={t("businessesHint")} />
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" data-testid="spending-businesses">
            <thead>
              <tr className="border-b border-border text-start text-xs text-muted-foreground">
                <th className="py-2 pe-3 text-start font-medium">{t("business")}</th>
                {CATEGORIES.map((c) => (
                  <th key={c} className="py-2 pe-3 text-start font-medium">
                    {usage(`categories.${c}`)}
                  </th>
                ))}
                <th className="py-2 text-end font-medium">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.businesses.map((b) => (
                <tr key={b.tenantId} className="border-b border-border/60 last:border-0">
                  <td className="py-3 pe-3 font-medium" dir="auto">
                    {b.name}
                  </td>
                  {CATEGORIES.map((c) => {
                    const v = b.spend.categories[c];
                    return (
                      <td
                        key={c}
                        className={
                          v.state === "reached"
                            ? "py-3 pe-3 text-danger tabular-nums"
                            : v.state === "warning"
                              ? "py-3 pe-3 text-warning tabular-nums"
                              : "py-3 pe-3 tabular-nums"
                        }
                      >
                        {money(v.spent)} / {money(v.cap)}
                      </td>
                    );
                  })}
                  <td className="py-3 text-end">
                    <div className="flex items-center justify-end gap-2">
                      <StatusPill
                        tone={b.status === "suspended" ? "danger" : "success"}
                        label={t(`statuses.${b.status}`)}
                      />
                      <Button
                        size="sm"
                        variant={b.status === "suspended" ? "secondary" : "ghost"}
                        disabled={pending}
                        onClick={() =>
                          void setStatus(
                            b.tenantId,
                            b.name,
                            b.status === "suspended" ? "active" : "suspended",
                          )
                        }
                      >
                        {b.status === "suspended" ? t("resume") : t("suspend")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHead icon={<Calculator />} title={t("limitsTitle")} hint={t("limitsHint")} />
        <form method="post" onSubmit={onLimits} className="mt-5 space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {CATEGORIES.map((c) => (
              <Field
                key={c}
                id={`max-${c}`}
                label={t("maxLabel", { what: usage(`categories.${c}`) })}
              >
                <Input
                  id={`max-${c}`}
                  name={`max-${c}`}
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={(data.settings.maxCapPence[c] / 100).toFixed(2)}
                  required
                />
              </Field>
            ))}
          </div>

          <fieldset>
            <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Globe2 className="size-4 text-muted-foreground" aria-hidden />
              {t("countries")}
            </legend>
            <div className="flex flex-wrap gap-4">
              {COUNTRIES.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    name={`country-${c}`}
                    defaultChecked={data.settings.allowedCountries.includes(c)}
                  />
                  {t(`countryNames.${c}`)}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t("countriesHint")}</p>
          </fieldset>

          <div>
            <p className="mb-2 text-sm font-semibold">{t("costsTitle")}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {COSTS.map((k) => (
                <Field key={k} id={k} label={t(`costs.${k}`)}>
                  <Input
                    id={k}
                    name={k}
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={data.settings.costs[k]}
                    required
                  />
                </Field>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t("costsHint")}</p>
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? common("working") : t("save")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
