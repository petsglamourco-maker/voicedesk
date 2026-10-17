import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { apiGetOrNull } from "@/lib/api";
import { GoogleCalendarCard, type IntegrationsResponse } from "./google-calendar-card";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage(props: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ google?: string }>;
}) {
  const { tenantId } = await props.params;
  const { google } = await props.searchParams;
  const data = await apiGetOrNull<IntegrationsResponse>(`/api/tenants/${tenantId}/integrations`);
  if (!data) notFound();
  const t = await getTranslations("integrations");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <GoogleCalendarCard tenantId={tenantId} initial={data.google} result={google ?? null} />
    </div>
  );
}
