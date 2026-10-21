"use client";

import { AuroraBackground, Badge, cn } from "@voicedesk/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "../brand-mark";

/**
 * Frame for screens outside a business (VA console, Platform admin): aurora background and a
 * glass top bar with the brand, a badge, optional section links and a way back.
 */
export function StandaloneShell(props: {
  badge: string;
  nav?: Array<{ href: string; label: string }>;
  navLabel?: string;
  back?: { href: string; label: string } | null;
  end?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="relative min-h-screen">
      <AuroraBackground />
      <header className="glass sticky top-0 z-30 border-x-0 border-t-0">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <BrandMark />
          <Badge tone="accent">{props.badge}</Badge>
          {props.nav ? (
            <nav aria-label={props.navLabel} className="flex flex-wrap gap-1">
              {props.nav.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-[0_0_18px_0_var(--color-glow)]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}
          <div className="ms-auto flex items-center gap-3">
            {props.end}
            {props.back ? (
              <Link
                href={props.back.href}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-primary hover:bg-muted"
              >
                <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
                {props.back.label}
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <main id="main" className="stagger mx-auto max-w-6xl space-y-6 px-4 py-8">
        {props.children}
      </main>
    </div>
  );
}
