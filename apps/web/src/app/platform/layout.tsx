import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { StandaloneShell } from "@/components/shell/standalone-shell";
import { getMe } from "@/lib/api";

/** Platform-owner area. Anyone else gets a 404, matching the API. */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect=/platform/setup");
  if (!me.user.isPlatformOwner) notFound();
  if (!me.user.twoFactorEnabled) redirect("/mfa-required");
  const t = await getTranslations("platform");
  const back = me.activeTenantId ?? me.tenants[0]?.tenantId;
  return (
    <StandaloneShell
      badge={t("badge")}
      navLabel={t("title")}
      nav={[
        { href: "/platform/setup", label: t("setup") },
        { href: "/platform/ai", label: t("aiProviders") },
        { href: "/platform/phone-numbers", label: t("phoneNumbers") },
        { href: "/platform/vas", label: t("vas") },
        { href: "/platform/spending", label: t("spending") },
        { href: "/platform/support", label: t("support") },
      ]}
      helpTenantId={back}
      back={back ? { href: `/t/${back}`, label: t("backToBusiness") } : null}
    >
      {children}
    </StandaloneShell>
  );
}
