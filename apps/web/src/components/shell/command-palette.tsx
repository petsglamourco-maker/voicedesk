"use client";

import { Dialog, DialogContent } from "@voicedesk/ui";
import { Command } from "cmdk";
import {
  Building2,
  CornerDownLeft,
  ExternalLink,
  LifeBuoy,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { Theme } from "@/lib/theme";
import type { NavGroup } from "./app-shell";
import { NAV_ICONS } from "./icons";

/** Ctrl/Cmd+K: jump to any screen or business, or switch the theme. */
export function CommandPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: NavGroup[];
  businesses: Array<{ id: string; name: string }>;
  currentTenantId: string;
  labels: {
    placeholder: string;
    empty: string;
    pages: string;
    businesses: string;
    actions: string;
  };
  themeLabels: Record<Theme, string>;
  onTheme: (theme: Theme) => void;
  onHelp: () => void;
  helpLabel: string;
  extra: Array<{ label: string; href: string }>;
}) {
  const router = useRouter();
  const go = (href: string) => {
    props.onOpenChange(false);
    router.push(href);
  };
  const itemClass =
    "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm text-foreground outline-none data-[selected=true]:bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] [&_svg]:size-4 [&_svg]:text-muted-foreground data-[selected=true]:[&_svg]:text-primary";
  const headingClass =
    "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase";
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        title={props.labels.placeholder}
        className="top-[18%] max-w-xl translate-y-0 p-0 [&>h2]:sr-only [&>div]:mt-0"
      >
        <Command label={props.labels.placeholder} className="flex flex-col">
          <Command.Input
            autoFocus
            placeholder={props.labels.placeholder}
            className="h-14 border-b border-border bg-transparent px-5 text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              {props.labels.empty}
            </Command.Empty>
            <Command.Group heading={props.labels.pages} className={headingClass}>
              {props.groups.flatMap((g) =>
                g.items.map((item) => {
                  const Icon = NAV_ICONS[item.icon];
                  return (
                    <Command.Item
                      key={item.href}
                      value={`${item.label} ${g.label}`}
                      onSelect={() => go(item.href)}
                      className={itemClass}
                    >
                      <Icon aria-hidden />
                      {item.label}
                      <span className="ms-auto text-xs text-muted-foreground">{g.label}</span>
                    </Command.Item>
                  );
                }),
              )}
              {props.extra.map((item) => (
                <Command.Item
                  key={item.href}
                  value={item.label}
                  onSelect={() => go(item.href)}
                  className={itemClass}
                >
                  <ExternalLink aria-hidden />
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
            {props.businesses.length > 1 ? (
              <Command.Group heading={props.labels.businesses} className={headingClass}>
                {props.businesses
                  .filter((b) => b.id !== props.currentTenantId)
                  .map((b) => (
                    <Command.Item
                      key={b.id}
                      value={`business ${b.name}`}
                      onSelect={() => go(`/t/${b.id}`)}
                      className={itemClass}
                    >
                      <Building2 aria-hidden />
                      {b.name}
                    </Command.Item>
                  ))}
              </Command.Group>
            ) : null}
            <Command.Group heading={props.labels.actions} className={headingClass}>
              <Command.Item
                value={`help support ${props.helpLabel}`}
                onSelect={() => {
                  props.onOpenChange(false);
                  props.onHelp();
                }}
                className={itemClass}
              >
                <LifeBuoy aria-hidden />
                {props.helpLabel}
              </Command.Item>
              {(
                [
                  ["dark", Moon],
                  ["light", Sun],
                  ["system", Monitor],
                ] as const
              ).map(([theme, Icon]) => (
                <Command.Item
                  key={theme}
                  value={`theme ${props.themeLabels[theme]}`}
                  onSelect={() => {
                    props.onTheme(theme);
                    props.onOpenChange(false);
                  }}
                  className={itemClass}
                >
                  <Icon aria-hidden />
                  {props.themeLabels[theme]}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <CornerDownLeft className="size-3.5" aria-hidden /> Enter
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
