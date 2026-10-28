import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { HelpWidget } from "@/components/help/help-widget";
import { apiGetOrNull, getMe } from "@/lib/api";
import { CreateBusinessForm, type OnboardingCountry } from "./create-business-form";

export const metadata: Metadata = { title: "Add your business" };

export default async function OnboardingPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect=/onboarding");
  const t = await getTranslations("onboarding");
  // ADR 0031: only the countries launched for sign-up.
  const launched = await apiGetOrNull<{ countries: OnboardingCountry[] }>("/api/public/countries");
  const countries = launched?.countries.length
    ? launched.countries
    : [{ code: "GB", name: "United Kingdom", timezones: ["Europe/London"] }];
  return (
    <AuthShell title={t("title")} description={t("subtitle")}>
      <CreateBusinessForm timeZones={Intl.supportedValuesOf("timeZone")} countries={countries} />
      <HelpWidget />
    </AuthShell>
  );
}
