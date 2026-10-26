import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SITE_NAME } from "@/components/site/brand";
import { Landing, type PublicPlan } from "@/components/site/landing";
import { apiGetOrNull, getMe } from "@/lib/api";

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME}: AI receptionist for small businesses` },
  description:
    "An AI receptionist that answers your calls, chat, WhatsApp and email 24/7, books appointments and takes messages, for a fraction of the cost of hiring.",
  openGraph: {
    title: `${SITE_NAME}: never miss another customer`,
    description:
      "Answers every call, books appointments and takes messages around the clock. From £29 a month.",
    type: "website",
  },
};

/**
 * Entry point. Signed in: straight to onboarding or the business. Signed out: the public
 * website (ADR 0030).
 */
export default async function Home() {
  const me = await getMe();
  if (me) {
    if (me.tenants.length === 0) redirect("/onboarding");
    const active = me.tenants.find((t) => t.tenantId === me.activeTenantId) ?? me.tenants[0]!;
    redirect(`/t/${active.tenantId}`);
  }
  const [pricing, demos] = await Promise.all([
    apiGetOrNull<{ trialDays: number; plans: PublicPlan[] }>("/api/public/plans"),
    apiGetOrNull<{ enabled: boolean }>("/api/public/demos/config"),
  ]);
  return (
    <Landing
      plans={pricing?.plans ?? []}
      trialDays={pricing?.trialDays ?? 14}
      demos={demos?.enabled ?? false}
    />
  );
}
