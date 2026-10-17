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
  const languages = useTranslations("languages");
  const common = useTranslations("common");
  const [settings, setSettings] = useState(props.initial.settings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setSaved(false);
  };

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
