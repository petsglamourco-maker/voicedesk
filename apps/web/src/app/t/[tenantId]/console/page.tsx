import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { TestConsole } from "./test-console";

export const metadata: Metadata = { title: "Test console" };

export default async function ConsolePage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const detail = await apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`);
  if (!detail) notFound();
  return <TestConsole tenantId={tenantId} defaultLanguage={detail.tenant.defaultLanguage} />;
}
