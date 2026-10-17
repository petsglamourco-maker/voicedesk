import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { ProfileEditor, type ProfileResponse } from "./profile-editor";

export const metadata: Metadata = { title: "Business profile" };

export default async function ProfilePage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [detail, profile] = await Promise.all([
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
    apiGetOrNull<ProfileResponse>(`/api/tenants/${tenantId}/profile`),
  ]);
  if (!detail || !profile) notFound();
  return (
    <ProfileEditor
      tenantId={tenantId}
      initial={profile}
      canEdit={detail.permissions.includes("knowledge:write")}
    />
  );
}
