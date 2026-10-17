import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getMe } from "@/lib/api";

/** Platform-owner area. Anyone else gets a 404, matching the API. */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect=/platform/ai");
  if (!me.user.isPlatformOwner) notFound();
  const t = await getTranslations("platform");
  const back = me.activeTenantId ?? me.tenants[0]?.tenantId;
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold tracking-tight">VoiceDesk</span>
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{t("badge")}</span>
          <nav aria-label={t("title")} className="flex gap-1">
            <Link
              href="/platform/ai"
              className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              {t("aiProviders")}
            </Link>
            <Link
              href="/platform/phone-numbers"
              className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              {t("phoneNumbers")}
            </Link>
          </nav>
          {back ? (
            <Link href={`/t/${back}`} className="ms-auto text-sm text-primary hover:underline">
              {t("backToBusiness")}
            </Link>
          ) : null}
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
