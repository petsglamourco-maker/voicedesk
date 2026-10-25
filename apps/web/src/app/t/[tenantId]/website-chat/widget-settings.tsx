"use client";

import {
  Alert,
  Button,
  Card,
  CardHead,
  Input,
  Label,
  Select,
  StatusPill,
  Textarea,
  useConfirm,
} from "@voicedesk/ui";
import {
  Check,
  CircleOff,
  Code2,
  Copy,
  Globe,
  MonitorSmartphone,
  Power,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { ScreenHero } from "@/components/screen-hero";

export interface WidgetView {
  key: string;
  enabled: boolean;
  allowedOrigins: string[];
  color: string;
  title: string;
  position: "left" | "right";
  snippet: string;
  previewUrl: string;
}

const WEB = "var(--color-ch-web)";

/** Three "window" dots for the browser-style frames (decorative). */
const WINDOW_DOTS = (
  <span aria-hidden className="flex shrink-0 items-center gap-1.5">
    <span className="size-2.5 rounded-full bg-danger/70" />
    <span className="size-2.5 rounded-full bg-warning/70" />
    <span className="size-2.5 rounded-full bg-success/70" />
  </span>
);

/** Website chat: turn it on, choose where it may appear, copy the snippet, preview it. */
export function WidgetSettings(props: { tenantId: string; initial: WidgetView; canEdit: boolean }) {
  const t = useTranslations("websiteChat");
  const shell = useTranslations("shell");
  const common = useTranslations("common");
  const confirm = useConfirm();
  const [widget, setWidget] = useState(props.initial);
  const [origins, setOrigins] = useState(props.initial.allowedOrigins.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const base = `/api/tenants/${props.tenantId}/widget`;

  async function save(next: Partial<WidgetView> = {}) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = { ...widget, ...next, allowedOrigins: origins.split(/\s+/).filter(Boolean) };
      const updated = await api<WidgetView>(base, {
        method: "PUT",
        body: JSON.stringify({
          enabled: body.enabled,
          allowedOrigins: body.allowedOrigins,
          color: body.color,
          title: body.title,
          position: body.position,
        }),
      });
      setWidget(updated);
      setOrigins(updated.allowedOrigins.join("\n"));
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
      setWidget(await api<WidgetView>(`${base}/regenerate`, { method: "POST" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="websiteChat"
        eyebrow={shell("groups.channels")}
        title={t("title")}
        description={t("subtitle")}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">{t("saved")}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card
            style={
              widget.enabled
                ? {
                    boxShadow: `0 0 40px -14px ${WEB}`,
                    borderColor: `color-mix(in srgb, ${WEB} 40%, transparent)`,
                  }
                : undefined
            }
          >
            <CardHead
              icon={<Power />}
              title={t("status")}
              hint={t("statusHint")}
              color={WEB}
              aside={
                widget.enabled ? (
                  <StatusPill tone="success" live label={t("on")} />
                ) : (
                  <StatusPill tone="neutral" icon={CircleOff} label={t("off")} />
                )
              }
            />
            {props.canEdit ? (
              <Button
                className="mt-4"
                variant={widget.enabled ? "secondary" : "primary"}
                disabled={busy}
                onClick={() => void save({ enabled: !widget.enabled })}
              >
                <Power aria-hidden />
                {widget.enabled ? t("turnOff") : t("turnOn")}
              </Button>
            ) : null}
          </Card>

          <Card>
            <CardHead icon={<Globe />} title={t("where")} hint={t("whereHint")} color={WEB} />
            <div className="mt-5 space-y-1.5">
              <Label htmlFor="origins" className="mb-0">
                {t("websites")}
              </Label>
              <Textarea
                id="origins"
                className="h-24 min-h-24 font-mono text-sm"
                placeholder="https://www.example.co.uk"
                value={origins}
                disabled={!props.canEdit}
                onChange={(e) => setOrigins(e.target.value)}
              />
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3 [&>*]:min-w-0">
              <div>
                <Label htmlFor="title">{t("chatTitle")}</Label>
                <Input
                  id="title"
                  value={widget.title}
                  maxLength={60}
                  disabled={!props.canEdit}
                  onChange={(e) => setWidget({ ...widget, title: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="color">{t("color")}</Label>
                <Input
                  id="color"
                  type="color"
                  className="h-10 cursor-pointer p-1"
                  value={widget.color}
                  disabled={!props.canEdit}
                  onChange={(e) => setWidget({ ...widget, color: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="position">{t("position")}</Label>
                <Select
                  id="position"
                  value={widget.position}
                  disabled={!props.canEdit}
                  onChange={(e) =>
                    setWidget({ ...widget, position: e.target.value as "left" | "right" })
                  }
                >
                  <option value="right">{t("right")}</option>
                  <option value="left">{t("left")}</option>
                </Select>
              </div>
            </div>
            {props.canEdit ? (
              <Button className="mt-5" disabled={busy} onClick={() => void save()}>
                {busy ? common("working") : t("save")}
              </Button>
            ) : null}
          </Card>

          <Card>
            <CardHead
              icon={<Code2 />}
              title={t("snippetTitle")}
              hint={t("snippetHint")}
              color={WEB}
            />
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background">
              <div className="flex items-center border-b border-border px-3 py-2">
                {WINDOW_DOTS}
              </div>
              <pre
                className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground"
                data-testid="widget-snippet"
                dir="ltr"
              >
                {widget.snippet}
              </pre>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void navigator.clipboard.writeText(widget.snippet).then(() => setCopied(true))
                }
              >
                {copied ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
                {copied ? t("copied") : t("copy")}
              </Button>
              {props.canEdit ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void regenerate()}>
                  <RefreshCw aria-hidden />
                  {t("regenerate")}
                </Button>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="relative self-start lg:sticky lg:top-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-4 rounded-[28px] opacity-60 blur-2xl"
            style={{
              background: `radial-gradient(60% 50% at 50% 30%, color-mix(in srgb, ${WEB} 35%, transparent), transparent 70%)`,
            }}
          />
          <div className="glass relative overflow-hidden rounded-xl">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              {WINDOW_DOTS}
              <p className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full border border-border bg-[color-mix(in_srgb,var(--color-surface)_65%,transparent)] px-3 py-1 text-xs font-semibold text-muted-foreground">
                <MonitorSmartphone
                  aria-hidden
                  className="size-3.5 shrink-0"
                  style={{ color: WEB }}
                />
                <span className="truncate">{t("preview")}</span>
              </p>
            </div>
            {widget.enabled ? (
              <iframe
                key={widget.key + widget.color + widget.title}
                title={t("preview")}
                src={widget.previewUrl}
                className="block h-[560px] w-full bg-background"
              />
            ) : (
              <div className="relative flex h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
                <div aria-hidden className="dot-grid pointer-events-none absolute inset-0" />
                <span
                  aria-hidden
                  className="flex size-12 items-center justify-center rounded-2xl [&_svg]:size-5"
                  style={{
                    color: WEB,
                    background: `color-mix(in srgb, ${WEB} 14%, transparent)`,
                    boxShadow: `0 0 24px -6px ${WEB}`,
                  }}
                >
                  <MonitorSmartphone />
                </span>
                <p className="max-w-64 text-sm text-muted-foreground">{t("previewOff")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
