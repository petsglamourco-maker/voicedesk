"use client";

import { Alert, Button, Input, Label, Select } from "@voicedesk/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { LOCALES } from "@/i18n/locales";

const COUNTRIES = ["GB"] as const;

export function CreateBusinessForm({ timeZones }: { timeZones: string[] }) {
  const t = useTranslations("onboarding");
  const languages = useTranslations("languages");
  const common = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        countryCode: form.get("countryCode"),
        timezone: form.get("timezone"),
        defaultLanguage: form.get("defaultLanguage"),
      }),
    });
    if (!res.ok) {
      setPending(false);
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? common("errorGeneric"));
      return;
    }
    const tenant = (await res.json()) as { id: string };
    await authClient.organization.setActive({ organizationId: tenant.id });
    router.push(`/t/${tenant.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <Label htmlFor="name">{t("businessName")}</Label>
        <Input
          id="name"
          name="name"
          required
          minLength={2}
          maxLength={120}
          autoComplete="organization"
        />
      </div>
      <div>
        <Label htmlFor="countryCode">{t("country")}</Label>
        <Select
          id="countryCode"
          name="countryCode"
          defaultValue="GB"
          aria-describedby="country-hint"
        >
          {COUNTRIES.map((code) => (
            <option key={code} value={code}>
              {t(`countries.${code}`)}
            </option>
          ))}
        </Select>
        <p id="country-hint" className="mt-1 text-xs text-muted-foreground">
          {t("moreCountriesSoon")}
        </p>
      </div>
      <div>
        <Label htmlFor="timezone">{t("timezone")}</Label>
        <Select id="timezone" name="timezone" defaultValue="Europe/London">
          {timeZones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="defaultLanguage">{t("language")}</Label>
        <Select id="defaultLanguage" name="defaultLanguage" defaultValue="en">
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {languages(code)}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? common("working") : t("create")}
      </Button>
    </form>
  );
}
