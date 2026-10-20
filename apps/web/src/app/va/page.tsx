import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getMe } from "@/lib/api";
import { VaConsole } from "./va-console";

export const metadata: Metadata = { title: "VA console" };

/** Human VA console (Phase 5): status, calls handed over by the assistant, chats needing a person. */
export default async function VaPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect=/va");
  const t = await getTranslations("va");
  const back = me.activeTenantId ?? me.tenants[0]?.tenantId;
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold tracking-tight">VoiceDesk</span>
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{t("badge")}</span>
          <span className="text-sm text-muted-foreground">{me.user.name}</span>
          {back ? (
            <Link href={`/t/${back}`} className="ms-auto text-sm text-primary hover:underline">
              {t("backToBusiness")}
            </Link>
          ) : null}
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <VaConsole />
      </main>
    </div>
  );
}
