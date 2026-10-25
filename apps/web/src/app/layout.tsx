import type { Metadata, Viewport } from "next";
import { Manrope, Sora } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { directionFor } from "@/i18n/locales";
import { THEME_COOKIE, toTheme } from "@/lib/theme";
import "./globals.css";

// Self-hosted at build time, subset, swapped: no layout shift, no request to Google at runtime.
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "VoiceDesk", template: "%s · VoiceDesk" },
  description: "AI receptionist, customer support and virtual assistant for your business.",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // Installed on an iPhone home screen: full screen, VoiceDesk's name under the icon.
  appleWebApp: { capable: true, title: "VoiceDesk", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  // Content can reach the screen edges; the mobile tab bar pads for the home indicator.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070b14" },
    { media: "(prefers-color-scheme: light)", color: "#f6f8fc" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations("common");
  // Dark is the default; the account menu switches to light or system.
  const theme = toTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang={locale}
      dir={directionFor(locale)}
      data-theme={theme}
      className={`${sora.variable} ${manrope.variable}`}
    >
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
