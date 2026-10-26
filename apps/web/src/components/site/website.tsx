import { apiGetOrNull } from "@/lib/api";
import { Landing, type PublicPlan } from "./landing";

/** The public website with live prices and the demo switch (served at / and /website). */
export async function Website() {
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
