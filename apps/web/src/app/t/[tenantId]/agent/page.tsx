import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { AgentSettingsForm, type AgentResponse } from "./agent-settings";

export const metadata: Metadata = { title: "Assistant" };

export default async function AgentPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [detail, agent] = await Promise.all([
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
    apiGetOrNull<AgentResponse>(`/api/tenants/${tenantId}/agent`),
  ]);
  if (!detail || !agent) notFound();
  return (
    <AgentSettingsForm
      tenantId={tenantId}
      initial={agent}
      canEdit={detail.permissions.includes("agent:configure")}
    />
  );
}
