"use client";

import { Alert, Button, Input, Label, Select } from "@voicedesk/ui";
import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { LOCALES } from "@/i18n/locales";

/** A launched country (ADR 0031): its own time zones come first in the list. */
export interface OnboardingCountry {
  code: string;
  name: string;
  timezones: string[];
}

export function CreateBusinessForm({
  timeZones,
  countries,
}: {
  timeZones: string[];
  countries: OnboardingCountry[];
}) {
  const t = useTranslations("onboarding");
  const languages = useTranslations("languages");
  const common = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [countryCode, setCountryCode] = useState(countries[0]?.code ?? "GB");
  const country = countries.find((c) => c.code === countryCode);
  const local = country?.timezones ?? ["Europe/London"];
  const others = timeZones.filter((tz) => !local.includes(tz));

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
    <form method="post" onSubmit={onSubmit} className="space-y-5">
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
          className="h-11"
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2 [&>*]:min-w-0">
        <div>
          <Label htmlFor="countryCode">{t("country")}</Label>
          <Select
            id="countryCode"
            name="countryCode"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            aria-describedby="country-hint"
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
          <p id="country-hint" className="mt-1.5 text-xs text-muted-foreground">
            {t("moreCountriesSoon")}
          </p>
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
      </div>
      <div>
        <Label htmlFor="timezone">{t("timezone")}</Label>
        <Select id="timezone" name="timezone" key={countryCode} defaultValue={local[0]}>
          {local.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replaceAll("_", " ")}
            </option>
          ))}
          <optgroup label={t("otherTimezones")}>
            {others.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replaceAll("_", " ")}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>
      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        <Building2 aria-hidden />
        {pending ? common("working") : t("create")}
      </Button>
    </form>
  );
}
