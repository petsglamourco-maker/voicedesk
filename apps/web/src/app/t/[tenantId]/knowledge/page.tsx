import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { KnowledgePanel } from "./knowledge-panel";
import { ScreenHero } from "@/components/screen-hero";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const detail = await apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`);
  if (!detail) notFound();
  const t = await getTranslations("knowledge");
  const shell = await getTranslations("shell");
  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="knowledge"
        eyebrow={shell("groups.assistant")}
        title={t("title")}
        description={t("subtitle")}
      />
      <KnowledgePanel
        tenantId={tenantId}
        canEdit={detail.permissions.includes("knowledge:write")}
      />
    </div>
  );
}
