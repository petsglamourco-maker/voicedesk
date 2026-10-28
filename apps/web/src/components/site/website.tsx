import { apiGetOrNull } from "@/lib/api";
import { Landing, type PublicPlan } from "./landing";

interface PlansResponse {
  trialDays: number;
  currency: string;
  currencies: string[];
  plans: PublicPlan[];
}

/**
 * The public website with live prices and the demo switch (served at / and /website).
 * Pricing shows the chosen currency; the savings comparison stays in pounds (ADR 0031).
 */
export async function Website(props: { currency?: string; path: string }) {
  const wanted = (props.currency ?? "GBP")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);
  const [pricing, uk, demos] = await Promise.all([
    apiGetOrNull<PlansResponse>(`/api/public/plans?currency=${wanted}`),
    wanted === "GBP" ? Promise.resolve(null) : apiGetOrNull<PlansResponse>("/api/public/plans"),
    apiGetOrNull<{ enabled: boolean }>("/api/public/demos/config"),
  ]);
  return (
    <Landing
      plans={pricing?.plans ?? []}
      ukPlans={(uk ?? pricing)?.plans ?? []}
      currency={pricing?.currency ?? "GBP"}
      currencies={pricing?.currencies ?? ["GBP"]}
      path={props.path}
      trialDays={pricing?.trialDays ?? 14}
      demos={demos?.enabled ?? false}
    />
  );
}
