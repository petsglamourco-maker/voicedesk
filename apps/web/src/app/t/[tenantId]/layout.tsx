import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { apiGetOrNull, getMe, type TenantDetail } from "@/lib/api";
import { BusinessSwitcher } from "./business-switcher";
import { SignOutButton } from "./sign-out-button";

export default async function TenantLayout(props: {
  children: ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await props.params;
  const me = await getMe();
  if (!me) redirect(`/sign-in?redirect=/t/${tenantId}`);
  const detail = await apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`);
  if (!detail) notFound();
  const t = await getTranslations("tenant");

  const nav = [
    { href: `/t/${tenantId}`, label: t("overview") },
    { href: `/t/${tenantId}/knowledge`, label: t("knowledge") },
    { href: `/t/${tenantId}/profile`, label: t("profile") },
    { href: `/t/${tenantId}/agent`, label: t("agent") },
    { href: `/t/${tenantId}/console`, label: t("console") },
    { href: `/t/${tenantId}/calls`, label: t("calls") },
    { href: `/t/${tenantId}/records`, label: t("records") },
    { href: `/t/${tenantId}/members`, label: t("members") },
    { href: `/t/${tenantId}/account`, label: t("account") },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold tracking-tight">VoiceDesk</span>
          <BusinessSwitcher
            currentId={tenantId}
            tenants={me.tenants.map((x) => ({ id: x.tenantId, name: x.name }))}
            label={t("switchBusiness")}
            newLabel={t("newBusiness")}
          />
          <div className="ms-auto flex items-center gap-3 text-sm">
            {me.user.isPlatformOwner ? (
              <Link href="/platform/ai" className="font-medium text-primary hover:underline">
                {t("platformAdmin")}
              </Link>
            ) : null}
            <span className="text-muted-foreground">{me.user.email}</span>
            <SignOutButton />
          </div>
        </div>
        <nav
          aria-label={t("navLabel")}
          className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4"
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-t-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        {props.children}
      </main>
    </div>
  );
}
