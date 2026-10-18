import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { MailboxSettings, type MailboxInfo } from "./mailbox-settings";

export const metadata: Metadata = { title: "Email" };

export default async function EmailPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [info, detail] = await Promise.all([
    apiGetOrNull<MailboxInfo>(`/api/tenants/${tenantId}/mailbox`),
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
  ]);
  if (!info || !detail) notFound();
  return (
    <MailboxSettings
      tenantId={tenantId}
      initial={info}
      canEdit={detail.permissions.includes("agent:configure")}
    />
  );
}
