"use client";

import { ConfirmProvider, TooltipProvider } from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { RegisterServiceWorker } from "./pwa/register-sw";
import { ReauthPrompt } from "./reauth-prompt";

/** App-wide UI providers: tooltips, styled confirm dialogs, toasts. */
export function Providers(props: { children: ReactNode }) {
  const t = useTranslations("common");
  return (
    <TooltipProvider delayDuration={250}>
      <ConfirmProvider cancelLabel={t("cancel")} confirmLabel={t("confirm")}>
        {props.children}
      </ConfirmProvider>
      <ReauthPrompt />
      <RegisterServiceWorker />
      <Toaster
        position="bottom-right"
        offset={{ bottom: 96, right: 24 }}
        mobileOffset={{ bottom: 88 }}
        toastOptions={{
          classNames: {
            toast:
              "glass !rounded-lg !border-border !bg-[var(--color-glass)] !text-foreground !shadow-[0_16px_50px_-12px_rgb(0_0_0/0.5)] font-sans",
            description: "!text-muted-foreground",
            success: "[&_[data-icon]]:!text-success",
            error: "[&_[data-icon]]:!text-danger",
          },
        }}
      />
    </TooltipProvider>
  );
}
