import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull } from "@/lib/api";
import { AiProvidersPanel, type ProvidersResponse } from "./ai-providers-panel";

export const metadata: Metadata = { title: "AI providers" };

export default async function AiProvidersPage() {
  const data = await apiGetOrNull<ProvidersResponse>("/api/platform/ai-providers");
  if (!data) notFound();
  return <AiProvidersPanel initial={data} />;
}
