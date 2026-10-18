import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { InboxView } from "../inbox-view";

export const metadata: Metadata = { title: "Inbox" };

/** Direct link to one thread (used in staff alert emails). */
export default async function InboxThreadPage(props: {
  params: Promise<{ tenantId: string; threadId: string }>;
}) {
  const { tenantId, threadId } = await props.params;
  const detail = await apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`);
  if (!detail) notFound();
  return (
    <InboxView
      tenantId={tenantId}
      selectedId={threadId}
      canReply={detail.permissions.includes("inbox:reply")}
    />
  );
}
