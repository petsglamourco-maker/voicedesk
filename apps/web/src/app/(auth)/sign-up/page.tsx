import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { safeRedirect } from "@/lib/safe-redirect";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage(props: { searchParams: Promise<{ redirect?: string }> }) {
  const t = await getTranslations("auth");
  const redirectTo = safeRedirect((await props.searchParams).redirect, "/onboarding");
  return (
    <AuthShell title={t("signUpTitle")} description={t("signUpSubtitle")}>
      <SignUpForm redirectTo={redirectTo} />
      <p className="mt-6 text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link
          className="font-medium text-primary underline-offset-4 hover:underline"
          href={`/sign-in?redirect=${encodeURIComponent(redirectTo)}`}
        >
          {t("signIn")}
        </Link>
      </p>
    </AuthShell>
  );
}
