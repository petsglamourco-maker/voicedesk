import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { FormSettings, type FormView } from "./form-settings";

export const metadata: Metadata = { title: "Forms" };

export default async function FormsPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [form, detail] = await Promise.all([
    apiGetOrNull<FormView>(`/api/tenants/${tenantId}/forms`),
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
  ]);
  if (!form || !detail) notFound();
  return (
    <FormSettings
      tenantId={tenantId}
      initial={form}
      canEdit={detail.permissions.includes("agent:configure")}
    />
  );
}
