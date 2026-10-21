import { PageHero } from "@voicedesk/ui";
import type { ComponentProps } from "react";
import { NAV_ICONS, type NavIcon } from "./shell/icons";

/**
 * The page header used across the app: the signature PageHero with the page's own menu icon.
 * Works in server and client components (no hooks); pass the translated menu group as eyebrow.
 */
export function ScreenHero({
  icon,
  ...props
}: Omit<ComponentProps<typeof PageHero>, "icon"> & { icon: NavIcon }) {
  const Icon = NAV_ICONS[icon];
  return <PageHero icon={<Icon />} {...props} />;
}
