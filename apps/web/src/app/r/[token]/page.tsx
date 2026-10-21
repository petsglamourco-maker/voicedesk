import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicCard } from "@/components/public-card";
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
    <PublicCard className="max-w-lg">
      <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase" dir="auto">
        {survey.businessName}
      </p>
      <h1
        className="mt-1 font-display text-[24px] leading-tight font-semibold tracking-tight"
        dir="auto"
        lang={survey.language}
      >
        {survey.question}
      </h1>
      <RatingForm
        token={token}
        kind={survey.kind}
        answered={survey.answered}
        businessName={survey.businessName}
      />
    </PublicCard>
  );
}
