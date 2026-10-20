import { Card } from "@voicedesk/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGetOrNull } from "@/lib/api";
import { RatingForm } from "./rating-form";

export const metadata: Metadata = { title: "Rate us", robots: { index: false } };

interface Survey {
  businessName: string;
  kind: "csat" | "nps";
  question: string;
  answered: boolean;
  language: string;
}

/** Public rating page from the link texted or emailed after a conversation (no sign-in). */
export default async function RatePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const survey = await apiGetOrNull<Survey>(`/api/public/feedback/${encodeURIComponent(token)}`);
  if (!survey) notFound();
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-12">
      <Card>
        <p className="text-sm text-muted-foreground">{survey.businessName}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight" dir="auto" lang={survey.language}>
          {survey.question}
        </h1>
        <RatingForm
          token={token}
          kind={survey.kind}
          answered={survey.answered}
          businessName={survey.businessName}
        />
      </Card>
    </main>
  );
}
