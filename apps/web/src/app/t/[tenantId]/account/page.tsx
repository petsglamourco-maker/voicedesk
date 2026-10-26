import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ScreenHero } from "@/components/screen-hero";
import { getMe } from "@/lib/api";
import { NameSettings } from "./name-settings";
import { PasswordSettings } from "./password-settings";
import { PushSettings } from "./push-settings";
import { SessionsSettings } from "./sessions-settings";
import { TwoFactorSettings } from "./two-factor-settings";
import { VoiceTypingSettings } from "./voice-typing-settings";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  const t = await getTranslations("account");
  const shell = await getTranslations("shell");
  return (
    <div className="stagger space-y-6">
      <ScreenHero icon="account" eyebrow={shell("groups.settings")} title={t("title")} />
      <NameSettings name={me.user.name} />
      <TwoFactorSettings enabled={me.user.twoFactorEnabled} />
      <PasswordSettings />
      <PushSettings />
      <VoiceTypingSettings />
      <SessionsSettings />
    </div>
  );
}
