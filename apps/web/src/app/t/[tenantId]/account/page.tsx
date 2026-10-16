import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getMe } from "@/lib/api";
import { TwoFactorSettings } from "./two-factor-settings";

export const metadata: Metadata = { title: "Account security" };

export default async function AccountPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  const t = await getTranslations("account");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <TwoFactorSettings enabled={me.user.twoFactorEnabled} />
    </div>
  );
}
