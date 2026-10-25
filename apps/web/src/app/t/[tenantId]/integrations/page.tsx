import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { apiGetOrNull } from "@/lib/api";
import { CalendarCard, type IntegrationsResponse } from "./calendar-card";
import { ScreenHero } from "@/components/screen-hero";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage(props: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ calendar?: string }>;
}) {
  const { tenantId } = await props.params;
  const { calendar } = await props.searchParams;
  const data = await apiGetOrNull<IntegrationsResponse>(`/api/tenants/${tenantId}/integrations`);
  if (!data) notFound();
  const t = await getTranslations("integrations");
  const shell = await getTranslations("shell");
  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="integrations"
        eyebrow={shell("groups.assistant")}
        title={t("title")}
        description={t("subtitle")}
      />
      <CalendarCard tenantId={tenantId} initial={data.calendar} result={calendar ?? null} />
    </div>
  );
}
