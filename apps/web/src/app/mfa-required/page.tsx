import { Alert } from "@voicedesk/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TwoFactorSettings } from "@/app/t/[tenantId]/account/two-factor-settings";
import { AuthShell } from "@/components/auth-shell";
import { getMe } from "@/lib/api";

export const metadata: Metadata = { title: "Turn on two-step login" };

/**
 * Where people land when a feature needs two-step login (security audit C1): why, and the
 * set-up right here. Works without a business (e.g. the platform owner).
 */
export default async function MfaRequiredPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect=/mfa-required");
  const t = await getTranslations("mfa");
  const back = me.activeTenantId ?? me.tenants[0]?.tenantId;
  return (
    <AuthShell title={t("title")} description={t("subtitle")} wide>
      <div className="space-y-5">
        {me.user.twoFactorEnabled ? (
          <Alert tone="success">{t("done")}</Alert>
        ) : (
          <Alert tone="info">{t("why")}</Alert>
        )}
        <TwoFactorSettings enabled={me.user.twoFactorEnabled} />
        {back ? (
          <Link
            href={`/t/${back}`}
            className="block text-sm font-medium text-primary hover:underline"
          >
            {t("back")}
          </Link>
        ) : null}
      </div>
    </AuthShell>
  );
}
