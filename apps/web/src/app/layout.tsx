import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { directionFor } from "@/i18n/locales";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VoiceDesk", template: "%s · VoiceDesk" },
  description: "AI receptionist, customer support and virtual assistant for your business.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations("common");
  return (
    <html lang={locale} dir={directionFor(locale)}>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
