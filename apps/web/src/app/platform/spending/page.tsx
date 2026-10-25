import { HeroStat, PageHero } from "@voicedesk/ui";
import { AlertTriangle, Building2, Gauge, PauseCircle } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { apiGetOrNull } from "@/lib/api";
import { SpendingPanel, type PlatformSpending } from "./spending-panel";

export const metadata: Metadata = { title: "Spending & limits" };

/** Platform admin → Spending & limits (ADR 0022): pause switches, allowance, cost estimates. */
export default async function SpendingPage() {
  const data = await apiGetOrNull<PlatformSpending>("/api/platform/spend-settings");
  if (!data) notFound();
  const t = await getTranslations("spending");
  const platform = await getTranslations("platform");
  const atLimit = data.businesses.filter((b) =>
    Object.values(b.spend.categories).some((c) => c.state === "reached"),
  ).length;
  const paused = Object.values(data.settings.paused).filter(Boolean).length;
  return (
    <>
      <PageHero
        icon={<Gauge />}
        eyebrow={platform("badge")}
        title={t("title")}
        description={t("subtitle")}
      >
        <HeroStat icon={<Building2 />} label={t("businesses")} value={data.businesses.length} />
        <HeroStat
          icon={<AlertTriangle />}
          label={t("atLimit")}
          value={atLimit}
          color="var(--color-warning)"
        />
        <HeroStat
          icon={<PauseCircle />}
          label={t("pausedCount")}
          value={paused}
          color="var(--color-danger)"
        />
      </PageHero>
      <SpendingPanel initial={data} />
    </>
  );
}
