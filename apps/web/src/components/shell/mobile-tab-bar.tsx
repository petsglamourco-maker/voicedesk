"use client";

import { cn } from "@voicedesk/ui";
import { Menu, Phone, Inbox, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Phones (under 768 px, ADR 0024): the four places people go most, in thumb reach.
 * "More" opens the full menu. Pads for the home indicator (safe-area inset).
 */
export function MobileTabBar(props: {
  tenantId: string;
  labels: { nav: string; today: string; inbox: string; calls: string; more: string };
  onMore: () => void;
}) {
  const pathname = usePathname();
  const base = `/t/${props.tenantId}`;
  const tabs = [
    { href: `${base}/today`, label: props.labels.today, Icon: Sun },
    { href: `${base}/inbox`, label: props.labels.inbox, Icon: Inbox },
    { href: `${base}/calls`, label: props.labels.calls, Icon: Phone },
  ];
  const item =
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <nav
      aria-label={props.labels.nav}
      data-testid="mobile-tabs"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-[color-mix(in_srgb,var(--color-background)_86%,transparent)] px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden"
    >
      <ul className="flex items-stretch gap-1">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <li key={href} className="flex flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  item,
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
        <li className="flex flex-1">
          <button
            type="button"
            onClick={props.onMore}
            className={cn(item, "text-muted-foreground hover:text-foreground")}
          >
            <Menu className="size-5" aria-hidden />
            {props.labels.more}
          </button>
        </li>
      </ul>
    </nav>
  );
}
