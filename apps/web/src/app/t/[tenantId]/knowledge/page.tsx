import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { KnowledgePanel } from "./knowledge-panel";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const detail = await apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`);
  if (!detail) notFound();
  const t = await getTranslations("knowledge");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <KnowledgePanel
        tenantId={tenantId}
        canEdit={detail.permissions.includes("knowledge:write")}
      />
    </div>
  );
}
