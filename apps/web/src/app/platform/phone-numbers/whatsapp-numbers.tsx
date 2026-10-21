"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Input,
  Label,
  Select,
  useConfirm,
} from "@voicedesk/ui";
import { Building2, MessageCircle, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { ChannelDot } from "@/components/channels";
import { WhatsAppIcon } from "@/components/shell/icons";
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
  const confirm = useConfirm();
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
    if (!(await confirm({ title: t("confirmRemove"), destructive: true }))) return;
    await api(`/api/platform/whatsapp-numbers/${id}`, { method: "DELETE" });
    await reload();
  }

  if (!data) return error ? <Alert tone="error">{error}</Alert> : null;
  const tenantName = (id: string) => data.tenants.find((x) => x.id === id)?.name ?? id;

  return (
    <Card>
      <CardHead
        icon={<WhatsAppIcon />}
        title={t("title")}
        hint={t("hint")}
        color="var(--color-ch-whatsapp)"
      />
      {!data.configured ? (
        <Alert tone="error" className="mt-4">
          {t("notConfigured")}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      ) : null}
      <form
        onSubmit={(e) => void add(e)}
        className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] lg:items-end [&>*]:min-w-0"
      >
        <div>
          <Label htmlFor="wa-display">{t("number")}</Label>
          <Input
            id="wa-display"
            name="displayNumber"
            required
            placeholder="+44 7700 900123"
            className="tabular"
          />
        </div>
        <div>
          <Label htmlFor="wa-id">{t("phoneNumberId")}</Label>
          <Input id="wa-id" name="phoneNumberId" required inputMode="numeric" className="tabular" />
        </div>
        <div>
          <Label htmlFor="wa-tenant">{t("business")}</Label>
          <Select id="wa-tenant" name="tenantId" required>
            {data.tenants.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={busy}>
          <Plus aria-hidden />
          {t("add")}
        </Button>
      </form>
      {data.numbers.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border">
          <EmptyState icon={MessageCircle} title={t("empty")} className="py-8" />
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-border rounded-xl border border-border text-sm">
          {data.numbers.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <ChannelDot channel="whatsapp" />
              <div className="min-w-0 flex-1 basis-48">
                <p className="tabular font-display text-base font-semibold" dir="ltr">
                  {n.displayNumber}
                </p>
                <p className="tabular text-xs text-muted-foreground">ID {n.phoneNumberId}</p>
              </div>
              <Badge tone="secondary">
                <Building2 aria-hidden />
                <span dir="auto">{tenantName(n.tenantId)}</span>
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                onClick={() => void remove(n.id)}
              >
                <Trash2 aria-hidden />
                {t("remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
