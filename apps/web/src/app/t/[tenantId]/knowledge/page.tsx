import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { KnowledgePanel } from "./knowledge-panel";
import { QuestionsToAnswer, type GapAnswer } from "./questions-to-answer";
import { ScreenHero } from "@/components/screen-hero";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [detail, gaps] = await Promise.all([
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
    apiGetOrNull<{ questions: GapAnswer[] }>(`/api/tenants/${tenantId}/gap-answers`),
  ]);
  if (!detail) notFound();
  const canEdit = detail.permissions.includes("knowledge:write");
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
      <QuestionsToAnswer tenantId={tenantId} initial={gaps?.questions ?? []} canEdit={canEdit} />
      <KnowledgePanel tenantId={tenantId} canEdit={canEdit} />
    </div>
  );
}
