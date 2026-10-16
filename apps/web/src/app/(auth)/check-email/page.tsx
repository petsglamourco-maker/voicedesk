import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage(props: { searchParams: Promise<{ email?: string }> }) {
  const t = await getTranslations("auth");
  const email = (await props.searchParams).email ?? "";
  return (
    <AuthShell title={t("checkEmailTitle")}>
      <p className="text-sm">{t("checkEmailBody", { email })}</p>
    </AuthShell>
  );
}
