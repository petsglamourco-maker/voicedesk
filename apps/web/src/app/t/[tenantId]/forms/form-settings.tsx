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
} from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { ScreenHero } from "@/components/screen-hero";

type MappedField = "name" | "email" | "phone" | "message" | "consent";
const MAPPED_FIELDS: MappedField[] = ["name", "email", "phone", "message", "consent"];

export interface FormView {
  key: string;
  enabled: boolean;
  title: string;
  intro: string;
  fieldMap: Partial<Record<MappedField, string>>;
  hostedUrl: string;
  webhookPath: string;
}

/** Form capture: the hosted enquiry form, and the webhook for forms the business already has. */
export function FormSettings(props: { tenantId: string; initial: FormView; canEdit: boolean }) {
  const t = useTranslations("forms");
  const shell = useTranslations("shell");
  const common = useTranslations("common");
  const base = `/api/tenants/${props.tenantId}/forms`;
  const [form, setForm] = useState(props.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  async function save(next: Partial<FormView> = {}) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = { ...form, ...next };
      setForm(
        await api<FormView>(base, {
          method: "PUT",
          body: JSON.stringify({
            enabled: body.enabled,
            title: body.title,
            intro: body.intro,
            fieldMap: body.fieldMap,
          }),
        }),
      );
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (!window.confirm(t("confirmRegenerate"))) return;
    setBusy(true);
    try {
      setForm(await api<FormView>(`${base}/regenerate`, { method: "POST" }));
    } finally {
      setBusy(false);
    }
  }

  const webhookShown = showSecret
    ? form.webhookPath
    : form.webhookPath.replace(/secret=.*/, "secret=••••••••");

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="forms"
        eyebrow={shell("groups.channels")}
        title={t("title")}
        description={t("subtitle")}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">{t("saved")}</Alert> : null}

      <Card>
        <div className="flex items-center gap-2">
          <CardTitle>{t("status")}</CardTitle>
          {form.enabled ? <Badge tone="success">{t("on")}</Badge> : <Badge>{t("off")}</Badge>}
        </div>
        <CardDescription>{t("statusHint")}</CardDescription>
        {props.canEdit ? (
          <Button
            className="mt-3"
            disabled={busy}
            onClick={() => void save({ enabled: !form.enabled })}
          >
            {form.enabled ? t("turnOff") : t("turnOn")}
          </Button>
        ) : null}
      </Card>

      <Card>
        <CardTitle>{t("hosted")}</CardTitle>
        <CardDescription>{t("hostedHint")}</CardDescription>
        <a
          href={form.hostedUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block break-all text-sm text-primary hover:underline"
          data-testid="form-link"
        >
          {form.hostedUrl}
        </a>
        <div className="mt-4 grid gap-4">
          <div>
            <Label htmlFor="form-title">{t("formTitle")}</Label>
            <Input
              id="form-title"
              value={form.title}
              maxLength={80}
              disabled={!props.canEdit}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="form-intro">{t("intro")}</Label>
            <textarea
              id="form-intro"
              className="mt-1 h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
              value={form.intro}
              maxLength={500}
              disabled={!props.canEdit}
              onChange={(e) => setForm({ ...form, intro: e.target.value })}
            />
          </div>
        </div>
        {props.canEdit ? (
          <Button className="mt-4" disabled={busy} onClick={() => void save()}>
            {busy ? common("working") : t("save")}
          </Button>
        ) : null}
      </Card>

      <Card>
        <CardTitle>{t("webhook")}</CardTitle>
        <CardDescription>{t("webhookHint")}</CardDescription>
        <pre className="mt-3 overflow-x-auto rounded bg-muted p-3 text-xs">
          {"https://<your-public-address>"}
          {webhookShown}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">{t("tunnelHint")}</p>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowSecret(!showSecret)}>
            {showSecret ? t("hideSecret") : t("showSecret")}
          </Button>
          {props.canEdit ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void regenerate()}>
              {t("regenerate")}
            </Button>
          ) : null}
        </div>

        <p className="mt-6 text-sm font-medium">{t("mapping")}</p>
        <p className="text-xs text-muted-foreground">{t("mappingHint")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {MAPPED_FIELDS.map((f) => (
            <div key={f}>
              <Label htmlFor={`map-${f}`}>{t(`fields.${f}`)}</Label>
              <Input
                id={`map-${f}`}
                value={form.fieldMap[f] ?? ""}
                placeholder={t("automatic")}
                maxLength={100}
                disabled={!props.canEdit}
                onChange={(e) =>
                  setForm({ ...form, fieldMap: { ...form.fieldMap, [f]: e.target.value } })
                }
              />
            </div>
          ))}
        </div>
        {props.canEdit ? (
          <Button className="mt-4" disabled={busy} onClick={() => void save()}>
            {busy ? common("working") : t("save")}
          </Button>
        ) : null}
      </Card>
    </div>
  );
}
