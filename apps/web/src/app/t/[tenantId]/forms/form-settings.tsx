"use client";

import {
  Alert,
  Button,
  Card,
  CardHead,
  Input,
  Label,
  StatusPill,
  Textarea,
  useConfirm,
} from "@voicedesk/ui";
import {
  CircleOff,
  ClipboardList,
  ExternalLink,
  Eye,
  EyeOff,
  Power,
  RefreshCw,
  Tags,
  Webhook,
} from "lucide-react";
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

const FORM = "var(--color-ch-form)";

/** Form capture: the hosted enquiry form, and the webhook for forms the business already has. */
export function FormSettings(props: { tenantId: string; initial: FormView; canEdit: boolean }) {
  const t = useTranslations("forms");
  const shell = useTranslations("shell");
  const common = useTranslations("common");
  const confirm = useConfirm();
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
    if (!(await confirm({ title: t("confirmRegenerate"), destructive: true }))) return;
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

      <Card
        style={
          form.enabled
            ? {
                borderColor: `color-mix(in srgb, ${FORM} 38%, transparent)`,
                boxShadow: `0 0 40px -16px ${FORM}`,
              }
            : undefined
        }
      >
        <CardHead
          icon={<Power />}
          title={t("status")}
          hint={t("statusHint")}
          color={FORM}
          aside={
            form.enabled ? (
              <StatusPill tone="success" live label={t("on")} />
            ) : (
              <StatusPill tone="neutral" icon={CircleOff} label={t("off")} />
            )
          }
        />
        {props.canEdit ? (
          <Button
            className="mt-4"
            variant={form.enabled ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => void save({ enabled: !form.enabled })}
          >
            <Power aria-hidden />
            {form.enabled ? t("turnOff") : t("turnOn")}
          </Button>
        ) : null}
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHead
            icon={<ClipboardList />}
            title={t("hosted")}
            hint={t("hostedHint")}
            color={FORM}
          />
          <a
            href={form.hostedUrl}
            target="_blank"
            rel="noreferrer"
            className="glass mt-4 flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-sm break-all text-secondary transition-colors hover:border-input hover:underline"
            data-testid="form-link"
            dir="ltr"
          >
            <span className="min-w-0 flex-1">{form.hostedUrl}</span>
            <ExternalLink aria-hidden className="size-4 shrink-0" style={{ color: FORM }} />
          </a>
          <div className="mt-5 grid gap-4">
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
              <Textarea
                id="form-intro"
                className="h-20 min-h-20 text-sm"
                value={form.intro}
                maxLength={500}
                disabled={!props.canEdit}
                onChange={(e) => setForm({ ...form, intro: e.target.value })}
              />
            </div>
          </div>
          {props.canEdit ? (
            <Button className="mt-5" disabled={busy} onClick={() => void save()}>
              {busy ? common("working") : t("save")}
            </Button>
          ) : null}
        </Card>

        <Card>
          <CardHead icon={<Webhook />} title={t("webhook")} hint={t("webhookHint")} color={FORM} />
          <pre
            className="glass mt-4 overflow-x-auto rounded-lg px-3 py-2.5 font-mono text-xs leading-relaxed"
            dir="ltr"
          >
            <span className="text-muted-foreground">{"https://<your-public-address>"}</span>
            {webhookShown}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">{t("tunnelHint")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowSecret(!showSecret)}>
              {showSecret ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {showSecret ? t("hideSecret") : t("showSecret")}
            </Button>
            {props.canEdit ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void regenerate()}>
                <RefreshCw aria-hidden />
                {t("regenerate")}
              </Button>
            ) : null}
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <CardHead
              as="h3"
              icon={<Tags />}
              title={t("mapping")}
              hint={t("mappingHint")}
              color={FORM}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              {MAPPED_FIELDS.map((f) => (
                <div key={f}>
                  <Label htmlFor={`map-${f}`}>{t(`fields.${f}`)}</Label>
                  <Input
                    id={`map-${f}`}
                    className="font-mono text-sm"
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
              <Button className="mt-5" disabled={busy} onClick={() => void save()}>
                {busy ? common("working") : t("save")}
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
