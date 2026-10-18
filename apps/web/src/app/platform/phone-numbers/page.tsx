import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull } from "@/lib/api";
import { PhoneNumbersPanel, type PhoneNumbersResponse } from "./phone-numbers-panel";
import { WhatsAppNumbers } from "./whatsapp-numbers";

export const metadata: Metadata = { title: "Phone numbers" };

export default async function PhoneNumbersPage() {
  const data = await apiGetOrNull<PhoneNumbersResponse>("/api/platform/phone-numbers");
  if (!data) notFound();
  return (
    <div className="space-y-8">
      <PhoneNumbersPanel initial={data} />
      <WhatsAppNumbers />
    </div>
  );
}
