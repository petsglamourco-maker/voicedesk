"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Input,
  Label,
  Select,
} from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

interface NumberView {
  id: string;
  tenantId: string;
  e164: string;
  label: string | null;
  carrier: "twilio" | "telnyx";
  status: string;
  routed: boolean;
}

export interface PhoneNumbersResponse {
  numbers: NumberView[];
  tenants: Array<{ id: string; name: string }>;
  sipConfigured: boolean;
}

/** Register numbers bought in Twilio or Telnyx and route them to a business (Phase 2b, ADR 0013). */
export function PhoneNumbersPanel({ initial }: { initial: PhoneNumbersResponse }) {
  const t = useTranslations("phoneNumbers");
  const common = useTranslations("common");
  const [numbers, setNumbers] = useState(initial.numbers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tenantName = (id: string) => initial.tenants.find((x) => x.id === id)?.name ?? id;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      const created = await api<NumberView>("/api/platform/phone-numbers", {
        method: "POST",
        body: JSON.stringify({
          e164: formString(data, "e164"),
          tenantId: formString(data, "tenantId"),
          label: formString(data, "label") || undefined,
          carrier: formString(data, "carrier"),
        }),
      });
      setNumbers((list) => [...list, created].sort((a, b) => a.e164.localeCompare(b.e164)));
      form.reset();
    });
  }

  function update(id: string, patch: Partial<Pick<NumberView, "tenantId" | "status">>) {
    void run(async () => {
      const updated = await api<NumberView>(`/api/platform/phone-numbers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setNumbers((list) => list.map((n) => (n.id === id ? updated : n)));
    });
  }

  function remove(id: string) {
    if (!window.confirm(t("confirmRemove"))) return;
    void run(async () => {
      await api(`/api/platform/phone-numbers/${id}`, { method: "DELETE" });
      setNumbers((list) => list.filter((n) => n.id !== id));
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      {!initial.sipConfigured ? <Alert tone="error">{t("notConfigured")}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <CardTitle>{t("addTitle")}</CardTitle>
        <CardDescription>{t("addHint")}</CardDescription>
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="e164">{t("number")}</Label>
            <Input id="e164" name="e164" required placeholder="+44 20 7946 0000" className="w-52" />
          </div>
          <div>
            <Label htmlFor="tenantId">{t("business")}</Label>
            <Select id="tenantId" name="tenantId" required className="w-56">
              {initial.tenants.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="carrier">{t("carrier")}</Label>
            <Select id="carrier" name="carrier" className="w-36">
              <option value="twilio">Twilio</option>
              <option value="telnyx">Telnyx</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="label">{t("label")}</Label>
            <Input
              id="label"
              name="label"
              maxLength={60}
              placeholder={t("labelPlaceholder")}
              className="w-44"
            />
          </div>
          <Button type="submit" disabled={busy || !initial.sipConfigured}>
            {busy ? common("working") : t("add")}
          </Button>
        </form>
      </Card>

      <Card className="p-0">
        {numbers.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="phone-numbers">
            {numbers.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="font-mono text-base">{n.e164}</span>
                <Badge data-testid="number-carrier">
                  {n.carrier === "telnyx" ? "Telnyx" : "Twilio"}
                </Badge>
                {n.label ? <span className="text-muted-foreground">{n.label}</span> : null}
                {n.status === "active" ? (
                  n.routed ? (
                    <Badge className="border-success/40 text-success">{t("routed")}</Badge>
                  ) : (
                    <Badge className="border-warning/40 text-warning">{t("notRouted")}</Badge>
                  )
                ) : (
                  <Badge>{t("disabled")}</Badge>
                )}
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <Label htmlFor={`tenant-${n.id}`} className="sr-only">
                    {t("business")}
                  </Label>
                  <Select
                    id={`tenant-${n.id}`}
                    className="h-9 w-48"
                    value={n.tenantId}
                    disabled={busy}
                    onChange={(e) => update(n.id, { tenantId: e.target.value })}
                    title={tenantName(n.tenantId)}
                  >
                    {initial.tenants.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      update(n.id, { status: n.status === "active" ? "disabled" : "active" })
                    }
                  >
                    {n.status === "active" ? t("disable") : t("enable")}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(n.id)}>
                    {t("remove")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle className="text-base">{t("twilioSetupTitle")}</CardTitle>
          <ol className="mt-3 list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
            <li>{t("twilioSetup1")}</li>
            <li>{t("twilioSetup2")}</li>
            <li>{t("twilioSetup3")}</li>
            <li>{t("setupLast")}</li>
          </ol>
        </Card>
        <Card>
          <CardTitle className="text-base">{t("telnyxSetupTitle")}</CardTitle>
          <ol className="mt-3 list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
            <li>{t("telnyxSetup1")}</li>
            <li>{t("telnyxSetup2")}</li>
            <li>{t("telnyxSetup3")}</li>
            <li>{t("setupLast")}</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
