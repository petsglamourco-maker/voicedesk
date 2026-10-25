import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ScreenHero } from "@/components/screen-hero";
import { apiGetOrNull, type DepartmentsView } from "@/lib/api";
import { DepartmentsEditor } from "./departments-editor";

export const metadata: Metadata = { title: "Departments & phone menu" };

export default async function DepartmentsPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const view = await apiGetOrNull<DepartmentsView>(`/api/tenants/${tenantId}/departments`);
  if (!view) notFound();
  const t = await getTranslations("departments");
  const shell = await getTranslations("shell");
  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="departments"
        eyebrow={shell("groups.assistant")}
        title={t("title")}
        description={t("subtitle")}
      />
      <DepartmentsEditor tenantId={tenantId} initial={view} />
    </div>
  );
}
