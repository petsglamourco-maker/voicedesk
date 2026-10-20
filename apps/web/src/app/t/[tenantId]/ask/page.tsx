import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { AskPanel } from "./ask-panel";

export const metadata: Metadata = { title: "Ask VoiceDesk" };

export default async function AskPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const detail = await apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`);
  if (!detail) notFound();
  return <AskPanel tenantId={tenantId} />;
}
