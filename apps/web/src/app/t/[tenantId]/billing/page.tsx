import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ScreenHero } from "@/components/screen-hero";
import { apiGetOrNull, type BillingView } from "@/lib/api";
import { BillingPanel } from "./billing-panel";

export const metadata: Metadata = { title: "Plan & billing" };

export default async function BillingPage(props: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { tenantId } = await props.params;
  const { checkout } = await props.searchParams;
  const view = await apiGetOrNull<BillingView>(`/api/tenants/${tenantId}/billing`);
  if (!view) notFound();
  const t = await getTranslations("billing");
  const shell = await getTranslations("shell");
  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="billing"
        eyebrow={shell("groups.settings")}
        title={t("title")}
        description={t("subtitle")}
      />
      <BillingPanel
        tenantId={tenantId}
        view={view}
        checkout={checkout === "done" || checkout === "cancelled" ? checkout : null}
      />
    </div>
  );
}
