import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage(props: { searchParams: Promise<{ email?: string }> }) {
  const t = await getTranslations("auth");
  const email = (await props.searchParams).email ?? "";
  return (
    <AuthShell title={t("checkEmailTitle")}>
      <div className="flex flex-col items-center py-2 text-center">
        <div aria-hidden className="relative mb-6">
          <div className="absolute -inset-4 animate-glow-pulse rounded-full bg-[radial-gradient(circle,var(--color-glow),transparent_70%)] blur-xl" />
          <div className="glass relative flex size-20 items-center justify-center rounded-3xl border-primary/40 shadow-[0_0_32px_-6px_var(--color-glow)]">
            <MailCheck className="size-9 text-primary" />
          </div>
        </div>
        <p className="max-w-sm text-[15px] leading-relaxed break-words">
          {t("checkEmailBody", { email })}
        </p>
      </div>
    </AuthShell>
  );
}
