import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull } from "@/lib/api";
import { VaAssignments, type VaResponse } from "./va-assignments";

export const metadata: Metadata = { title: "VAs" };

export default async function VasPage() {
  const data = await apiGetOrNull<VaResponse>("/api/platform/vas");
  if (!data) notFound();
  return <VaAssignments initial={data} />;
}
