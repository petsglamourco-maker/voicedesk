import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StandaloneShell } from "@/components/shell/standalone-shell";
import { getMe } from "@/lib/api";
import { VaConsole } from "./va-console";

export const metadata: Metadata = { title: "VA console" };

/** Human VA console (Phase 5): status, calls handed over by the assistant, chats needing a person. */
export default async function VaPage(props: {
  searchParams: Promise<{ tenant?: string; dial?: string; contact?: string }>;
}) {
  const query = await props.searchParams;
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect=/va");
  const t = await getTranslations("va");
  const back = me.activeTenantId ?? me.tenants[0]?.tenantId;
  return (
    <StandaloneShell
      badge={t("badge")}
      back={back ? { href: `/t/${back}`, label: t("backToBusiness") } : null}
      end={<span className="hidden text-sm text-muted-foreground sm:inline">{me.user.name}</span>}
    >
      <VaConsole
        dial={
          query.tenant && query.dial
            ? { tenantId: query.tenant, to: query.dial, contactId: query.contact ?? null }
            : null
        }
      />
    </StandaloneShell>
  );
}
