import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { InboxView } from "./inbox-view";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const detail = await apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`);
  if (!detail) notFound();
  return (
    <InboxView
      tenantId={tenantId}
      selectedId={null}
      canReply={detail.permissions.includes("inbox:reply")}
    />
  );
}
