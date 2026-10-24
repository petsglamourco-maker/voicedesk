import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

/** The emailed link lands here with ?token=… (or ?error=INVALID_TOKEN when it's expired). */
export default async function ResetPasswordPage(props: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const t = await getTranslations("auth");
  const { token, error } = await props.searchParams;
  return (
    <AuthShell title={t("resetTitle")} description={token ? t("resetSubtitle") : undefined}>
      {token && !error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-sm">
          {t("resetInvalid")}{" "}
          <Link
            className="font-medium text-primary underline-offset-4 hover:underline"
            href="/forgot-password"
          >
            {t("resetAgain")}
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
