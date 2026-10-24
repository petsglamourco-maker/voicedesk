import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { HelpWidget } from "@/components/help/help-widget";
import { getMe } from "@/lib/api";
import { CreateBusinessForm } from "./create-business-form";

export const metadata: Metadata = { title: "Add your business" };

export default async function OnboardingPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect=/onboarding");
  const t = await getTranslations("onboarding");
  return (
    <AuthShell title={t("title")} description={t("subtitle")}>
      <CreateBusinessForm timeZones={Intl.supportedValuesOf("timeZone")} />
      <HelpWidget />
    </AuthShell>
  );
}
