import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Alert } from "@voicedesk/ui";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AppShell, SIDEBAR_COOKIE, type NavGroup } from "@/components/shell/app-shell";
import {
  apiGetOrNull,
  getMe,
  type BillingView,
  type SpendView,
  type TenantDetail,
} from "@/lib/api";
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
  const help = await getTranslations("help");
  const jar = await cookies();
  const format = await getFormatter();
  const base = `/t/${tenantId}`;
  // Owners and admins see spending (ADR 0022); everyone sees a suspension.
  const canSeeSpend = detail.permissions.includes("tenant:update");
  const spend = canSeeSpend
    ? await apiGetOrNull<SpendView>(`/api/tenants/${tenantId}/spend`)
    : null;
  const billing = canSeeSpend
    ? await apiGetOrNull<BillingView>(`/api/tenants/${tenantId}/billing`)
    : null;
  const trialDaysLeft = billing?.trialDaysLeft ?? null;
  const billingLink = (
    <Link href={`${base}/billing`} className="font-semibold text-primary hover:underline">
      {s("billingLink")}
    </Link>
  );
  const usageLink = (
    <Link href={`${base}/usage`} className="font-semibold text-primary hover:underline">
      {s("usageLink")}
    </Link>
  );

  const groups: NavGroup[] = [
    {
      label: s("groups.overview"),
      items: [
        { href: base, label: t("overview"), icon: "dashboard" },
        { href: `${base}/today`, label: t("today"), icon: "today" },
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
        ...(canSeeSpend
          ? [
              { href: `${base}/usage`, label: t("usage"), icon: "usage" as const },
              { href: `${base}/billing`, label: t("billing"), icon: "billing" as const },
            ]
          : []),
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
        tabs: {
          today: t("today"),
          inbox: t("inbox"),
          calls: t("calls"),
          more: s("more"),
        },
        platformAdmin: t("platformAdmin"),
        help: help("palette"),
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
      {me.mfa.deadline ? (
        <Alert tone="warning" className="mb-6" data-testid="mfa-banner">
          {s("mfaBanner", {
            date: format.dateTime(new Date(me.mfa.deadline), { dateStyle: "long" }),
          })}{" "}
          <Link href="/mfa-required" className="font-semibold text-primary hover:underline">
            {s("mfaSetup")}
          </Link>
        </Alert>
      ) : null}
      {detail.tenant.status === "suspended" ? (
        <Alert tone="error" className="mb-6" data-testid="suspended-banner">
          {s("suspendedBanner")}
        </Alert>
      ) : billing && !billing.usable ? (
        <Alert tone="error" className="mb-6" data-testid="plan-banner">
          {s(`planBanner.${billing.reason ?? "canceled"}`)} {billingLink}
        </Alert>
      ) : billing?.status === "past_due" ? (
        <Alert tone="warning" className="mb-6" data-testid="plan-banner">
          {s("planBanner.pastDue")} {billingLink}
        </Alert>
      ) : spend?.categories.ai.state === "reached" ? (
        <Alert tone="warning" className="mb-6" data-testid="spend-banner">
          {s(spend.businessCaps ? "aiCapBanner" : "aiAllowanceBanner")}{" "}
          {spend.businessCaps ? usageLink : billingLink}
        </Alert>
      ) : trialDaysLeft !== null && trialDaysLeft <= 3 ? (
        <Alert tone="info" className="mb-6" data-testid="trial-banner">
          {s("trialBanner", { days: trialDaysLeft })} {billingLink}
        </Alert>
      ) : spend && (spend.paused.ai || spend.paused.sms || spend.paused.outboundCalls) ? (
        <Alert tone="warning" className="mb-6" data-testid="paused-banner">
          {s("pausedBanner", {
            what: [
              spend.paused.ai ? s("pausedWhat.ai") : null,
              spend.paused.sms ? s("pausedWhat.sms") : null,
              spend.paused.outboundCalls ? s("pausedWhat.calls") : null,
            ]
              .filter(Boolean)
              .join(", "),
          })}
        </Alert>
      ) : null}
      {props.children}
    </AppShell>
  );
}
