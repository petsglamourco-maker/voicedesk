import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WifiOff } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = { title: "Offline" };

/** Shown by the service worker when the phone has no connection (no customer data). */
export default async function OfflinePage() {
  const t = await getTranslations("pwa");
  return (
    <main
      id="main"
      className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center"
    >
      <BrandMark size="lg" />
      <WifiOff className="size-10 text-muted-foreground" aria-hidden />
      <div className="max-w-sm space-y-2">
        <h1 className="font-display text-2xl font-semibold">{t("offlineTitle")}</h1>
        <p className="text-muted-foreground">{t("offlineBody")}</p>
      </div>
      <a
        href="/today"
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        {t("tryAgain")}
      </a>
    </main>
  );
}
