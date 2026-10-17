"use client";

import {
  Alert,
  Button,
  Card,
  CardDescription,
  CardTitle,
  cn,
  Input,
  Label,
  Select,
} from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { LOCALES } from "@/i18n/locales";

interface Settings {
  personaId: string;
  personaNames: Record<string, string>;
  enabledLanguages: string[];
  adminLanguage: string;
  recordCalls: boolean;
  reminderHours: number;
  customerConfirmations: boolean;
  alertPhone: string | null;
  voiceIds: Record<string, string>;
  transferPhone: string | null;
  transferHours: string;
  onCallPhone: string | null;
  urgentSituations: string | null;
}

export interface AgentResponse {
  settings: Settings;
  personas: Array<{
    id: string;
    defaultName: string;
    gender: string;
    style: string;
    bestFor: string;
  }>;
}

export function AgentSettingsForm(props: {
  tenantId: string;
  initial: AgentResponse;
  canEdit: boolean;
}) {
  const t = useTranslations("agent");
  const tv = useTranslations("voice");
  const tn = useTranslations("notifications");
  const tt = useTranslations("transfers");
  const languages = useTranslations("languages");
  const common = useTranslations("common");
  const [settings, setSettings] = useState(props.initial.settings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewLanguage, setPreviewLanguage] = useState(
    props.initial.settings.enabledLanguages[0] ?? "en",
  );

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setSaved(false);
  };

  async function preview(personaId: string) {
    setPreviewing(personaId);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${props.tenantId}/agent/voice-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personaId, language: previewLanguage }),
      });
      if (res.status === 503) throw new Error(tv("previewUnavailable"));
      if (!res.ok) throw new Error(common("errorGeneric"));
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPreviewing(null);
    }
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api(`/api/tenants/${props.tenantId}/agent`, {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">{t("saved")}</Alert> : null}

      <fieldset disabled={!props.canEdit || pending} className="space-y-6">
        <Card>
          <CardTitle>{t("persona")}</CardTitle>
          <CardDescription>{t("personaHint")}</CardDescription>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Label htmlFor="previewLanguage" className="text-sm">
              {tv("preview")}:
            </Label>
            <Select
              id="previewLanguage"
              className="h-9 w-40"
              value={previewLanguage}
              onChange={(e) => setPreviewLanguage(e.target.value)}
            >
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {languages(code)}
                </option>
              ))}
            </Select>
          </div>
          <div
            role="radiogroup"
            aria-label={t("persona")}
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            {props.initial.personas.map((p) => {
              const selected = settings.personaId === p.id;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-lg border p-4",
                    selected ? "border-primary ring-2 ring-primary/30" : "border-border",
                  )}
                >
                  <label className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="persona"
                      className="mt-1"
                      checked={selected}
                      onChange={() => update({ personaId: p.id })}
                    />
                    <span>
                      <span className="block font-medium">
                        {settings.personaNames[p.id] || p.defaultName}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({t(`gender.${p.gender}`)})
                        </span>
                      </span>
                      <span className="block text-sm text-muted-foreground">{p.style}</span>
                      <span className="mt-1 block text-xs">{t("bestFor", { use: p.bestFor })}</span>
                    </span>
                  </label>
                  <div className="mt-3">
                    <Label htmlFor={`name-${p.id}`} className="text-xs">
                      {t("rename")}
                    </Label>
                    <Input
                      id={`name-${p.id}`}
                      className="h-9"
                      placeholder={p.defaultName}
                      maxLength={40}
                      value={settings.personaNames[p.id] ?? ""}
                      onChange={(e) => {
                        const names = { ...settings.personaNames, [p.id]: e.target.value };
                        if (!e.target.value.trim()) delete names[p.id];
                        update({ personaNames: names });
                      }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => void preview(p.id)}
                    disabled={previewing !== null}
                  >
                    {previewing === p.id ? common("working") : `▶ ${tv("preview")}`}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardTitle>{t("languages")}</CardTitle>
          <CardDescription>{t("languagesHint")}</CardDescription>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {LOCALES.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.enabledLanguages.includes(code)}
                  onChange={(e) =>
                    update({
                      enabledLanguages: e.target.checked
                        ? [...settings.enabledLanguages, code]
                        : settings.enabledLanguages.filter((l) => l !== code),
                    })
                  }
                />
                {languages(code)}
              </label>
            ))}
          </div>
          <div className="mt-4 max-w-xs">
            <Label htmlFor="adminLanguage">{t("adminLanguage")}</Label>
            <Select
              id="adminLanguage"
              value={settings.adminLanguage}
              onChange={(e) => update({ adminLanguage: e.target.value })}
            >
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {languages(code)}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        <Card>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.recordCalls}
              onChange={(e) => update({ recordCalls: e.target.checked })}
            />
            <span>
              <span className="block font-medium">{tv("recordCalls")}</span>
              <span className="block text-sm text-muted-foreground">{tv("recordCallsHint")}</span>
            </span>
          </label>
        </Card>

        <Card>
          <CardTitle>{tn("title")}</CardTitle>
          <CardDescription>{tn("hint")}</CardDescription>
          <div className="mt-4 space-y-4">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={settings.customerConfirmations}
                onChange={(e) => update({ customerConfirmations: e.target.checked })}
              />
              <span>
                <span className="block font-medium">{tn("confirmations")}</span>
                <span className="block text-muted-foreground">{tn("confirmationsHint")}</span>
              </span>
            </label>
            <div className="max-w-xs">
              <Label htmlFor="reminderHours">{tn("reminder")}</Label>
              <Select
                id="reminderHours"
                value={String(settings.reminderHours)}
                onChange={(e) => update({ reminderHours: Number(e.target.value) })}
              >
                {[0, 2, 12, 24, 48].map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? tn("noReminder") : tn("hoursBefore", { hours: h })}
                  </option>
                ))}
              </Select>
            </div>
            <div className="max-w-xs">
              <Label htmlFor="alertPhone">{tn("alertPhone")}</Label>
              <Input
                id="alertPhone"
                inputMode="tel"
                placeholder="07700 900123"
                value={settings.alertPhone ?? ""}
                onChange={(e) => update({ alertPhone: e.target.value || null })}
              />
              <p className="mt-1 text-xs text-muted-foreground">{tn("alertPhoneHint")}</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>{tt("title")}</CardTitle>
          <CardDescription>{tt("hint")}</CardDescription>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="transferPhone">{tt("transferPhone")}</Label>
              <Input
                id="transferPhone"
                inputMode="tel"
                placeholder="07700 900123"
                value={settings.transferPhone ?? ""}
                onChange={(e) => update({ transferPhone: e.target.value || null })}
              />
            </div>
            <div>
              <Label htmlFor="transferHours">{tt("when")}</Label>
              <Select
                id="transferHours"
                value={settings.transferHours}
                onChange={(e) => update({ transferHours: e.target.value })}
              >
                <option value="open">{tt("whenOpen")}</option>
                <option value="always">{tt("whenAlways")}</option>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="urgentSituations">{tt("urgent")}</Label>
              <Input
                id="urgentSituations"
                placeholder={tt("urgentPlaceholder")}
                maxLength={500}
                value={settings.urgentSituations ?? ""}
                onChange={(e) => update({ urgentSituations: e.target.value || null })}
              />
            </div>
            <div>
              <Label htmlFor="onCallPhone">{tt("onCall")}</Label>
              <Input
                id="onCallPhone"
                inputMode="tel"
                placeholder="07700 900456"
                value={settings.onCallPhone ?? ""}
                onChange={(e) => update({ onCallPhone: e.target.value || null })}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{tt("note")}</p>
        </Card>

        {props.canEdit ? (
          <Button
            onClick={() => void save()}
            disabled={pending || settings.enabledLanguages.length === 0}
          >
            {pending ? common("working") : t("save")}
          </Button>
        ) : null}
      </fieldset>
    </div>
  );
}
