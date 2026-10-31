import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ScreenHero } from "@/components/screen-hero";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { NumbersPanel, type NumbersView } from "./numbers-panel";

export const metadata: Metadata = { title: "Phone numbers" };

/** The business's phone numbers (ADR 0032): get one on a paid plan, add extras, give one up. */
export default async function NumbersPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [view, detail] = await Promise.all([
    apiGetOrNull<NumbersView>(`/api/tenants/${tenantId}/numbers`),
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
  ]);
  if (!view || !detail) notFound();
  const t = await getTranslations("numbers");
  const shell = await getTranslations("shell");
  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="numbers"
        eyebrow={shell("groups.settings")}
        title={t("title")}
        description={t("subtitle")}
      />
      <NumbersPanel
        tenantId={tenantId}
        view={view}
        canManage={detail.permissions.includes("billing:manage")}
        businessName={detail.tenant.name}
      />
    </div>
  );
}
