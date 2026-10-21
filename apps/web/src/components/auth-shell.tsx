import { AuroraBackground } from "@voicedesk/ui";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";

/**
 * Centered card for sign-in, sign-up and other standalone pages: vivid aurora, the glowing
 * brand mark and a glass card with the signature aurora edge.
 */
export function AuthShell(props: {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main
      id="main"
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12"
    >
      <AuroraBackground intensity="vivid" />
      <div className={props.wide ? "w-full max-w-xl" : "w-full max-w-md"}>
        <div className="mb-8 flex justify-center">
          <BrandMark size="lg" />
        </div>
        <div className="glass aurora-border relative animate-rise overflow-hidden rounded-xl p-6 shadow-[0_24px_80px_-24px_var(--color-glow)] sm:p-8">
          <div aria-hidden className="spotlight pointer-events-none absolute inset-0" />
          <div aria-hidden className="dot-grid pointer-events-none absolute inset-0" />
          <div className="relative">
            <h1 className="font-display text-[26px] leading-tight font-semibold tracking-tight">
              {props.title}
            </h1>
            {props.description ? (
              <p className="mt-1.5 text-[15px] text-muted-foreground">{props.description}</p>
            ) : null}
            <div className="mt-6">{props.children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
