import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { WidgetSettings, type WidgetView } from "./widget-settings";

export const metadata: Metadata = { title: "Website chat" };

export default async function WebsiteChatPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [widget, detail] = await Promise.all([
    apiGetOrNull<WidgetView>(`/api/tenants/${tenantId}/widget`),
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
  ]);
  if (!widget || !detail) notFound();
  return (
    <WidgetSettings
      tenantId={tenantId}
      initial={widget}
      canEdit={detail.permissions.includes("agent:configure")}
    />
  );
}
