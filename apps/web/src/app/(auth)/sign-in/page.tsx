import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { safeRedirect } from "@/lib/safe-redirect";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: { searchParams: Promise<{ redirect?: string }> }) {
  const t = await getTranslations("auth");
  const redirectTo = safeRedirect((await props.searchParams).redirect);
  return (
    <AuthShell title={t("signInTitle")} description={t("signInSubtitle")}>
      <SignInForm redirectTo={redirectTo} />
      <p className="mt-6 text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link
          className="font-medium text-primary underline-offset-4 hover:underline"
          href={`/sign-up?redirect=${encodeURIComponent(redirectTo)}`}
        >
          {t("signUp")}
        </Link>
      </p>
    </AuthShell>
  );
}
