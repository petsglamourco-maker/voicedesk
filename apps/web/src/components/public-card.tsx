import { AuroraBackground, cn } from "@voicedesk/ui";
import type { ReactNode } from "react";

/**
 * Frame for pages customers see on a business's behalf (hosted form, rating link): the aurora
 * and signature glass card, but no VoiceDesk branding (the business is the brand here).
 */
export function PublicCard(props: { children: ReactNode; className?: string }) {
  return (
    <main
      id="main"
      className="relative flex min-h-screen items-start justify-center overflow-hidden px-4 py-12 sm:items-center"
    >
      <AuroraBackground intensity="vivid" />
      <div
        className={cn(
          "glass aurora-border relative w-full max-w-xl animate-rise overflow-hidden rounded-xl p-6 shadow-[0_24px_80px_-24px_var(--color-glow)] sm:p-8",
          props.className,
        )}
      >
        <div aria-hidden className="spotlight pointer-events-none absolute inset-0" />
        <div className="relative">{props.children}</div>
      </div>
    </main>
  );
}
