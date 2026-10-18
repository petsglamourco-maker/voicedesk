import { Card } from "@voicedesk/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull } from "@/lib/api";
import { EnquiryForm } from "./enquiry-form";

export const metadata: Metadata = { title: "Contact us", robots: { index: false } };

interface FormInfo {
  businessName: string;
  title: string | null;
  intro: string | null;
}

/** Public enquiry form for a business (no sign-in). */
export default async function HostedFormPage(props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  const info = await apiGetOrNull<FormInfo>(`/api/public/forms/${encodeURIComponent(key)}`);
  if (!info) notFound();
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-10">
      <Card>
        <h1 className="text-xl font-semibold tracking-tight" dir="auto">
          {info.title ?? info.businessName}
        </h1>
        {info.intro ? (
          <p className="mt-1 text-sm text-muted-foreground" dir="auto">
            {info.intro}
          </p>
        ) : null}
        <EnquiryForm formKey={key} businessName={info.businessName} />
      </Card>
    </main>
  );
}
