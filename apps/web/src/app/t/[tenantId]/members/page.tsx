import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { apiGetOrNull, getMe, type TenantDetail } from "@/lib/api";
import { MembersPanel } from "./members-panel";
import { ScreenHero } from "@/components/screen-hero";

export const metadata: Metadata = { title: "Team" };

export default async function MembersPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [detail, me] = await Promise.all([
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
    getMe(),
  ]);
  if (!detail || !me) notFound();
  const t = await getTranslations("members");
  const shell = await getTranslations("shell");
  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="members"
        eyebrow={shell("groups.settings")}
        title={t("title")}
        description={t("subtitle")}
      />
      <MembersPanel
        tenantId={tenantId}
        currentUserId={me.user.id}
        canManage={detail.permissions.includes("members:invite")}
        assignableRoles={detail.role === "owner" ? ["owner", "admin", "staff"] : ["admin", "staff"]}
      />
    </div>
  );
}
