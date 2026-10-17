import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull } from "@/lib/api";
import { ContactDetail, type ContactDetailResponse } from "./contact-detail";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage(props: {
  params: Promise<{ tenantId: string; contactId: string }>;
}) {
  const { tenantId, contactId } = await props.params;
  const data = await apiGetOrNull<ContactDetailResponse>(
    `/api/tenants/${tenantId}/contacts/${contactId}`,
  );
  if (!data) notFound();
  return <ContactDetail tenantId={tenantId} initial={data} />;
}
