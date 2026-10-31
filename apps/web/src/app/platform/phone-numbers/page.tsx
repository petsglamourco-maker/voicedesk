import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull } from "@/lib/api";
import { PhoneNumbersPanel, type PhoneNumbersResponse } from "./phone-numbers-panel";
import { NumberPurchasesCard, type NumberPurchases } from "./number-purchases";
import { WhatsAppNumbers } from "./whatsapp-numbers";

export const metadata: Metadata = { title: "Phone numbers" };

export default async function PhoneNumbersPage() {
  const [data, purchases] = await Promise.all([
    apiGetOrNull<PhoneNumbersResponse>("/api/platform/phone-numbers"),
    apiGetOrNull<NumberPurchases>("/api/platform/number-purchases"),
  ]);
  if (!data) notFound();
  return (
    <div className="space-y-8">
      <PhoneNumbersPanel initial={data} />
      {purchases ? <NumberPurchasesCard initial={purchases} /> : null}
      <WhatsAppNumbers />
    </div>
  );
}
