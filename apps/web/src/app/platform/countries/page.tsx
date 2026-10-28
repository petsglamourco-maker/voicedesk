import { Card, PageHero } from "@voicedesk/ui";
import { Globe2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { apiGetOrNull } from "@/lib/api";
import { CountriesForm, type PlatformCountry } from "./countries-form";

export const metadata: Metadata = { title: "Countries" };

/** Platform admin → Countries (ADR 0031): launch country packs after legal review. */
export default async function CountriesPage() {
  const data = await apiGetOrNull<{ countries: PlatformCountry[] }>("/api/platform/countries");
  if (!data) notFound();
  const t = await getTranslations("platformCountries");
  const platform = await getTranslations("platform");
  return (
    <>
      <PageHero
        icon={<Globe2 />}
        eyebrow={platform("badge")}
        title={t("title")}
        description={t("subtitle")}
      />
      <Card>
        <CountriesForm countries={data.countries} />
      </Card>
    </>
  );
}
