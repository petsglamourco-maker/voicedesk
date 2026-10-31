"use client";

import {
  Alert,
  Button,
  Card,
  CardHead,
  Input,
  Label,
  StatusPill,
  type StatusTone,
} from "@voicedesk/ui";
import { ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";

export interface NumberPurchases {
  settings: { autoBuy: boolean; dailyLimit: number; perBusiness: number };
  available: boolean;
  orders: Array<{
    id: string;
    business: string;
    e164: string;
    numberType: string;
    kind: string;
    status: string;
    reason: string | null;
  }>;
}

const TONE: Record<string, StatusTone> = {
  waiting_review: "info",
  buying: "info",
  active: "success",
  failed: "danger",
  cancelled: "neutral",
};

/** ADR 0032: the switch for buying numbers automatically (it costs money), and the orders. */
export function NumberPurchasesCard(props: { initial: NumberPurchases }) {
  const t = useTranslations("numberPurchases");
  const router = useRouter();
  const [settings, setSettings] = useState(props.initial.settings);
  const [busy, setBusy] = useState(false);
  return (
    <Card data-testid="number-purchases">
      <CardHead icon={<ShoppingCart />} title={t("title")} hint={t("hint")} />
      {!props.initial.available ? (
        <Alert tone="info" className="mt-4">
          {t("notSetUp")}
        </Alert>
      ) : null}
      <form
        method="post"
        className="mt-5 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/api/platform/number-purchases", {
              method: "PUT",
              body: JSON.stringify(settings),
            });
            toast.success(t("saved"));
            router.refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={settings.autoBuy}
            onChange={(e) => setSettings({ ...settings, autoBuy: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t("autoBuy")}</span>
            <span className="block text-muted-foreground">{t("autoBuyHint")}</span>
          </span>
        </label>
        <div className="grid max-w-md gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="dailyLimit">{t("dailyLimit")}</Label>
            <Input
              id="dailyLimit"
              type="number"
              min={1}
              max={100}
              className="tabular"
              value={settings.dailyLimit}
              onChange={(e) =>
                setSettings({ ...settings, dailyLimit: Number(e.target.value) || 1 })
              }
            />
          </div>
          <div>
            <Label htmlFor="perBusiness">{t("perBusiness")}</Label>
            <Input
              id="perBusiness"
              type="number"
              min={1}
              max={50}
              className="tabular"
              value={settings.perBusiness}
              onChange={(e) =>
                setSettings({ ...settings, perBusiness: Number(e.target.value) || 1 })
              }
            />
          </div>
        </div>
        <Button type="submit" disabled={busy}>
          {t("save")}
        </Button>
      </form>
      {props.initial.orders.length ? (
        <ul className="mt-6 divide-y divide-border text-sm">
          {props.initial.orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-medium">{o.business}</span>
              <span className="tabular">{o.e164}</span>
              <span className="text-muted-foreground">
                {o.numberType} · {o.kind}
              </span>
              <StatusPill tone={TONE[o.status] ?? "neutral"} label={o.status} />
              {o.reason ? <span className="text-xs text-muted-foreground">{o.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
