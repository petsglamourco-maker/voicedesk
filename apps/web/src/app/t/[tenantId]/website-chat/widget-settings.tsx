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

/** Website chat: turn it on, choose where it may appear, copy the snippet, preview it. */
export function WidgetSettings(props: { tenantId: string; initial: WidgetView; canEdit: boolean }) {
  const t = useTranslations("websiteChat");
  const shell = useTranslations("shell");
  const common = useTranslations("common");
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
    if (!window.confirm(t("confirmRegenerate"))) return;
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

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-2">
              <CardTitle>{t("status")}</CardTitle>
              {widget.enabled ? <Badge tone="success">{t("on")}</Badge> : <Badge>{t("off")}</Badge>}
            </div>
            <CardDescription>{t("statusHint")}</CardDescription>
            {props.canEdit ? (
              <Button
                className="mt-3"
                disabled={busy}
                onClick={() => void save({ enabled: !widget.enabled })}
              >
                {widget.enabled ? t("turnOff") : t("turnOn")}
              </Button>
            ) : null}
          </Card>

          <Card>
            <CardTitle>{t("where")}</CardTitle>
            <CardDescription>{t("whereHint")}</CardDescription>
            <Label htmlFor="origins" className="mt-3 block">
              {t("websites")}
            </Label>
            <textarea
              id="origins"
              className="mt-1 h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-sm"
              placeholder="https://www.example.co.uk"
              value={origins}
              disabled={!props.canEdit}
              onChange={(e) => setOrigins(e.target.value)}
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
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
                  className="h-10 p-1"
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
              <Button className="mt-4" disabled={busy} onClick={() => void save()}>
                {busy ? common("working") : t("save")}
              </Button>
            ) : null}
          </Card>

          <Card>
            <CardTitle>{t("snippetTitle")}</CardTitle>
            <CardDescription>{t("snippetHint")}</CardDescription>
            <pre
              className="mt-3 overflow-x-auto rounded bg-muted p-3 text-xs"
              data-testid="widget-snippet"
            >
              {widget.snippet}
            </pre>
            <div className="mt-3 flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void navigator.clipboard.writeText(widget.snippet).then(() => setCopied(true))
                }
              >
                {copied ? t("copied") : t("copy")}
              </Button>
              {props.canEdit ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void regenerate()}>
                  {t("regenerate")}
                </Button>
              ) : null}
            </div>
          </Card>
        </div>

        <Card className="p-0">
          <p className="px-4 pt-4 text-sm font-medium">{t("preview")}</p>
          {widget.enabled ? (
            <iframe
              key={widget.key + widget.color + widget.title}
              title={t("preview")}
              src={widget.previewUrl}
              className="m-4 h-[560px] w-[calc(100%-2rem)] rounded-lg border border-border"
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("previewOff")}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
