import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicCard } from "@/components/public-card";
import { apiGetOrNull } from "@/lib/api";
import { EnquiryForm } from "./enquiry-form";

export const metadata: Metadata = { title: "Contact us", robots: { index: false } };

interface FormInfo {
  businessName: string;
  title: string | null;
  intro: string | null;
  siteKey: string | null;
}

/** Public enquiry form for a business (no sign-in). */
export default async function HostedFormPage(props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  const info = await apiGetOrNull<FormInfo>(`/api/public/forms/${encodeURIComponent(key)}`);
  if (!info) notFound();
  return (
    <PublicCard>
      <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase" dir="auto">
        {info.businessName}
      </p>
      <h1
        className="mt-1 font-display text-[26px] leading-tight font-semibold tracking-tight"
        dir="auto"
      >
        {info.title ?? info.businessName}
      </h1>
      {info.intro ? (
        <p className="mt-1.5 text-[15px] text-muted-foreground" dir="auto">
          {info.intro}
        </p>
      ) : null}
      <EnquiryForm formKey={key} businessName={info.businessName} siteKey={info.siteKey} />
    </PublicCard>
  );
}
