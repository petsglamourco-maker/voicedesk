import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ScreenHero } from "@/components/screen-hero";
import { apiGetOrNull, type SpendView } from "@/lib/api";
import { UsageLimits } from "./usage-limits";

export const metadata: Metadata = { title: "Usage & limits" };

export default async function UsagePage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const spend = await apiGetOrNull<SpendView>(`/api/tenants/${tenantId}/spend`);
  if (!spend) notFound();
  const t = await getTranslations("usage");
  const shell = await getTranslations("shell");
  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="usage"
        eyebrow={shell("groups.settings")}
        title={t("title")}
        description={t("subtitle")}
      />
      <UsageLimits tenantId={tenantId} initial={spend} />
    </div>
  );
}
