import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull } from "@/lib/api";
import { ContactsPanel, type ContactListResponse } from "./contacts-panel";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage(props: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { tenantId } = await props.params;
  const { q } = await props.searchParams;
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  const data = await apiGetOrNull<ContactListResponse>(`/api/tenants/${tenantId}/contacts${query}`);
  if (!data) notFound();
  return <ContactsPanel tenantId={tenantId} initial={data} query={q ?? ""} />;
}
