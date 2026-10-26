import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PublicCard } from "@/components/public-card";
import { apiGetOrNull } from "@/lib/api";
import { DemoBuilder } from "./demo-builder";

export const metadata: Metadata = {
  title: "Try VoiceDesk",
  description: "Hear an AI receptionist built from your own website in about a minute.",
};

interface DemoConfig {
  enabled: boolean;
  siteKey: string | null;
  voice: boolean;
}

/** Instant demo (ADR 0029): public, no sign-in. Off until the platform owner switches it on. */
export default async function TryPage() {
  const t = await getTranslations("tryDemo");
  const config = await apiGetOrNull<DemoConfig>("/api/public/demos/config");
  return (
    <PublicCard className="max-w-2xl">
      <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">VoiceDesk</p>
      <h1 className="mt-1 font-display text-[26px] leading-tight font-semibold tracking-tight">
        {t("title")}
      </h1>
      <p className="mt-2 text-[15px] text-muted-foreground">{t("subtitle")}</p>
      {config?.enabled ? (
        <DemoBuilder siteKey={config.siteKey} voice={config.voice} />
      ) : (
        <p className="mt-6 rounded-lg border border-border p-4 text-sm" data-testid="demo-off">
          {t("off")}
        </p>
      )}
    </PublicCard>
  );
}
