import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { apiGetOrNull, getMe, type TenantDetail } from "@/lib/api";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Team" };

export default async function MembersPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [detail, me] = await Promise.all([
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
    getMe(),
  ]);
  if (!detail || !me) notFound();
  const t = await getTranslations("members");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <MembersPanel
        tenantId={tenantId}
        currentUserId={me.user.id}
        canManage={detail.permissions.includes("members:invite")}
        assignableRoles={detail.role === "owner" ? ["owner", "admin", "staff"] : ["admin", "staff"]}
      />
    </div>
  );
}
