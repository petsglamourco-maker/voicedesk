"use client";

import {
  Alert,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Input,
  Label,
  Select,
} from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

interface WhatsAppNumbers {
  numbers: Array<{
    id: string;
    tenantId: string;
    phoneNumberId: string;
    displayNumber: string | null;
    enabled: boolean;
  }>;
  tenants: Array<{ id: string; name: string }>;
  configured: boolean;
}

/** Platform admin: connect WhatsApp numbers (Meta phone-number ids) to businesses. */
export function WhatsAppNumbers() {
  const t = useTranslations("whatsappAdmin");
  const common = useTranslations("common");
  const [data, setData] = useState<WhatsAppNumbers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<WhatsAppNumbers>("/api/platform/whatsapp-numbers")
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : common("errorGeneric"));
      });
    return () => {
      cancelled = true;
    };
  }, [common]);

  const reload = async () => setData(await api<WhatsAppNumbers>("/api/platform/whatsapp-numbers"));

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await api("/api/platform/whatsapp-numbers", {
        method: "POST",
        body: JSON.stringify({
          tenantId: formString(values, "tenantId"),
          phoneNumberId: formString(values, "phoneNumberId").trim(),
          displayNumber: formString(values, "displayNumber"),
        }),
      });
      form.reset();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("confirmRemove"))) return;
    await api(`/api/platform/whatsapp-numbers/${id}`, { method: "DELETE" });
    await reload();
  }

  if (!data) return error ? <Alert tone="error">{error}</Alert> : null;
  const tenantName = (id: string) => data.tenants.find((x) => x.id === id)?.name ?? id;

  return (
    <Card>
      <CardTitle>{t("title")}</CardTitle>
      <CardDescription>{t("hint")}</CardDescription>
      {!data.configured ? (
        <Alert tone="error" className="mt-3">
          {t("notConfigured")}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      ) : null}
      <form onSubmit={(e) => void add(e)} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="wa-display">{t("number")}</Label>
          <Input
            id="wa-display"
            name="displayNumber"
            required
            placeholder="+44 7700 900123"
            className="w-48"
          />
        </div>
        <div>
          <Label htmlFor="wa-id">{t("phoneNumberId")}</Label>
          <Input id="wa-id" name="phoneNumberId" required inputMode="numeric" className="w-52" />
        </div>
        <div>
          <Label htmlFor="wa-tenant">{t("business")}</Label>
          <Select id="wa-tenant" name="tenantId" required className="w-56">
            {data.tenants.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={busy}>
          {t("add")}
        </Button>
      </form>
      <ul className="mt-4 divide-y divide-border text-sm">
        {data.numbers.length === 0 ? (
          <li className="py-2 text-muted-foreground">{t("empty")}</li>
        ) : null}
        {data.numbers.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="font-mono">{n.displayNumber}</span>
            <span className="text-xs text-muted-foreground">ID {n.phoneNumberId}</span>
            <span>{tenantName(n.tenantId)}</span>
            <Button variant="ghost" size="sm" className="ms-auto" onClick={() => void remove(n.id)}>
              {t("remove")}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
