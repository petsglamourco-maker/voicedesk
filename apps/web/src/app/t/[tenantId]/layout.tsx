import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AppShell, SIDEBAR_COOKIE, type NavGroup } from "@/components/shell/app-shell";
import { apiGetOrNull, getMe, type TenantDetail } from "@/lib/api";
import { THEME_COOKIE, toTheme } from "@/lib/theme";
import { BusinessSwitcher } from "./business-switcher";

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
  const s = await getTranslations("shell");
  const common = await getTranslations("common");
  const jar = await cookies();
  const base = `/t/${tenantId}`;

  const groups: NavGroup[] = [
    {
      label: s("groups.overview"),
      items: [
        { href: base, label: t("overview"), icon: "dashboard" },
        { href: `${base}/inbox`, label: t("inbox"), icon: "inbox" },
        { href: `${base}/ask`, label: t("ask"), icon: "ask" },
      ],
    },
    {
      label: s("groups.customers"),
      items: [
        { href: `${base}/calls`, label: t("calls"), icon: "calls" },
        { href: `${base}/contacts`, label: t("contacts"), icon: "contacts" },
        { href: `${base}/records`, label: t("records"), icon: "records" },
        { href: `${base}/feedback`, label: t("feedback"), icon: "feedback" },
      ],
    },
    {
      label: s("groups.channels"),
      items: [
        { href: `${base}/website-chat`, label: t("websiteChat"), icon: "websiteChat" },
        { href: `${base}/whatsapp`, label: t("whatsapp"), icon: "whatsapp" },
        { href: `${base}/email`, label: t("email"), icon: "email" },
        { href: `${base}/forms`, label: t("forms"), icon: "forms" },
      ],
    },
    {
      label: s("groups.assistant"),
      items: [
        { href: `${base}/agent`, label: t("agent"), icon: "agent" },
        { href: `${base}/knowledge`, label: t("knowledge"), icon: "knowledge" },
        { href: `${base}/profile`, label: t("profile"), icon: "profile" },
        { href: `${base}/integrations`, label: t("integrations"), icon: "integrations" },
        { href: `${base}/console`, label: t("console"), icon: "console" },
      ],
    },
    {
      label: s("groups.settings"),
      items: [
        { href: `${base}/members`, label: t("members"), icon: "members" },
        { href: `${base}/account`, label: t("account"), icon: "account" },
      ],
    },
  ];
  const businesses = me.tenants.map((x) => ({ id: x.tenantId, name: x.name }));

  return (
    <AppShell
      tenantId={tenantId}
      businessName={detail.tenant.name}
      businesses={businesses}
      businessSwitcher={
        <BusinessSwitcher
          currentId={tenantId}
          tenants={businesses}
          label={t("switchBusiness")}
          newLabel={t("newBusiness")}
        />
      }
      groups={groups}
      user={{ name: me.user.name, email: me.user.email, isPlatformOwner: me.user.isPlatformOwner }}
      theme={toTheme(jar.get(THEME_COOKIE)?.value)}
      collapsed={jar.get(SIDEBAR_COOKIE)?.value === "collapsed"}
      labels={{
        nav: t("navLabel"),
        search: s("search"),
        collapse: s("collapse"),
        expand: s("expand"),
        openMenu: s("openMenu"),
        account: s("account"),
        theme: s("theme"),
        themes: { dark: s("themes.dark"), light: s("themes.light"), system: s("themes.system") },
        vaConsole: t("vaConsole"),
        platformAdmin: t("platformAdmin"),
        signOut: common("signOut"),
        notifications: s("notifications"),
        palette: {
          placeholder: s("palette.placeholder"),
          empty: s("palette.empty"),
          pages: s("palette.pages"),
          businesses: s("palette.businesses"),
          actions: s("palette.actions"),
        },
        notices: {
          chats: String(s.raw("notices.chats")),
          calls: String(s.raw("notices.calls")),
          none: s("notices.none"),
        },
      }}
    >
      {props.children}
    </AppShell>
  );
}
