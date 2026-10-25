"use client";

import {
  AuroraBackground,
  Avatar,
  Button,
  cn,
  Dialog,
  DialogTrigger,
  DrawerContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Tooltip,
} from "@voicedesk/ui";
import {
  ChevronsLeft,
  ChevronsRight,
  Headphones,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Shield,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import { HELP_OPEN_EVENT, HelpWidget } from "../help/help-widget";
import { CommandPalette } from "./command-palette";
import { MobileTabBar } from "./mobile-tab-bar";
import { NAV_ICONS, type NavIcon } from "./icons";
import { Notifications } from "./notifications";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface ShellLabels {
  nav: string;
  search: string;
  collapse: string;
  expand: string;
  openMenu: string;
  account: string;
  theme: string;
  themes: Record<Theme, string>;
  vaConsole: string;
  platformAdmin: string;
  help: string;
  signOut: string;
  notifications: string;
  palette: {
    placeholder: string;
    empty: string;
    pages: string;
    businesses: string;
    actions: string;
  };
  notices: { chats: string; calls: string; none: string };
  tabs: { today: string; inbox: string; calls: string; more: string };
}

export const SIDEBAR_COOKIE = "vd-sidebar";

function setCookie(name: string, value: string) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax${secure}`;
}

/** The signed-in app frame: sidebar, top bar (search, notifications, account) and aurora. */
export function AppShell(props: {
  tenantId: string;
  businessName: string;
  businessSwitcher: ReactNode;
  businesses: Array<{ id: string; name: string }>;
  groups: NavGroup[];
  user: { name: string; email: string; isPlatformOwner: boolean };
  theme: Theme;
  collapsed: boolean;
  labels: ShellLabels;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(props.collapsed);
  const [theme, setTheme] = useState<Theme>(props.theme);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { labels } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the mobile menu after navigating (adjusting state during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setDrawerOpen(false);
  }

  function changeTheme(next: Theme) {
    setTheme(next);
    setCookie(THEME_COOKIE, next);
    document.documentElement.dataset.theme = next;
  }

  function toggleSidebar() {
    setCollapsed(!collapsed);
    setCookie(SIDEBAR_COOKIE, collapsed ? "open" : "collapsed");
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  const isActive = (href: string) =>
    href === `/t/${props.tenantId}` ? pathname === href : pathname.startsWith(href);

  const navList = (compact: boolean) => (
    <nav aria-label={labels.nav} className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
      {props.groups.map((group) => (
        <div key={group.label}>
          {compact ? (
            <div className="mx-3 mb-2 h-px bg-border" />
          ) : (
            <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {group.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const active = isActive(item.href);
              const link = (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-200",
                    compact && "justify-center px-0",
                    active
                      ? "bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {active ? (
                    <span className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-primary shadow-[0_0_12px_2px_var(--color-glow)]" />
                  ) : null}
                  <Icon
                    className={cn("size-[18px] shrink-0", active ? "text-primary" : "")}
                    aria-hidden
                  />
                  <span className={compact ? "sr-only" : "truncate"}>{item.label}</span>
                </Link>
              );
              return (
                <li key={item.href}>
                  {compact ? (
                    <Tooltip content={item.label} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (compact: boolean) => (
    <Link
      href={`/t/${props.tenantId}`}
      className={cn("flex items-center gap-2.5 px-4 py-4", compact && "justify-center px-0")}
    >
      <span className="relative flex size-8 items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--color-primary),var(--color-secondary)_60%,var(--color-accent))] shadow-[0_0_20px_0_var(--color-glow)]">
        <Headphones className="size-4 text-primary-foreground" aria-hidden />
      </span>
      <span
        className={cn(
          "font-display text-[17px] font-semibold tracking-tight",
          compact && "sr-only",
        )}
      >
        VoiceDesk
      </span>
    </Link>
  );

  return (
    <div className="relative min-h-screen">
      <AuroraBackground />
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "glass fixed inset-y-0 start-0 z-30 hidden flex-col border-y-0 border-s-0 transition-[width] duration-300 ease-[var(--ease-spring)] lg:flex",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        {brand(collapsed)}
        {collapsed ? null : <div className="px-4 pb-4">{props.businessSwitcher}</div>}
        {navList(collapsed)}
        <div className="border-t border-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "w-full justify-start text-muted-foreground",
              collapsed && "justify-center",
            )}
            onClick={toggleSidebar}
            aria-label={collapsed ? labels.expand : labels.collapse}
          >
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
            {collapsed ? null : labels.collapse}
          </Button>
        </div>
      </aside>

      <div
        className={cn("transition-[padding] duration-300", collapsed ? "lg:ps-[76px]" : "lg:ps-64")}
      >
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-border bg-[color-mix(in_srgb,var(--color-background)_72%,transparent)] backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
            <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label={labels.openMenu}
                >
                  <Menu />
                </Button>
              </DialogTrigger>
              <DrawerContent title={labels.nav} className="p-0">
                {brand(false)}
                <div className="px-4 pb-4">{props.businessSwitcher}</div>
                {navList(false)}
              </DrawerContent>
            </Dialog>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="glass flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full px-4 text-sm text-muted-foreground transition-colors hover:text-foreground sm:max-w-md"
            >
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{labels.search}</span>
              <span className="ms-auto hidden items-center gap-1 sm:flex">
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <div className="ms-auto flex items-center gap-1.5">
              <Tooltip content={labels.vaConsole}>
                <Link
                  href="/va"
                  target="_blank"
                  className="hidden size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:flex"
                  aria-label={labels.vaConsole}
                >
                  <Headphones className="size-[18px]" />
                </Link>
              </Tooltip>
              <Notifications
                tenantId={props.tenantId}
                label={labels.notifications}
                notices={labels.notices}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    aria-label={labels.account}
                  >
                    <Avatar name={props.user.name} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel className="text-foreground">
                    <span className="block text-sm font-semibold">{props.user.name}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {props.user.email}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{labels.theme}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(v) => changeTheme(v as Theme)}
                  >
                    <DropdownMenuRadioItem value="dark">
                      <Moon className="size-4 text-muted-foreground" aria-hidden />
                      {labels.themes.dark}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="light">
                      <Sun className="size-4 text-muted-foreground" aria-hidden />
                      {labels.themes.light}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <Monitor className="size-4 text-muted-foreground" aria-hidden />
                      {labels.themes.system}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/va" target="_blank">
                      <Headphones />
                      {labels.vaConsole}
                    </Link>
                  </DropdownMenuItem>
                  {props.user.isPlatformOwner ? (
                    <DropdownMenuItem asChild>
                      <Link href="/platform/setup">
                        <Shield />
                        {labels.platformAdmin}
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void signOut()}>
                    <LogOut />
                    {labels.signOut}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <main
          id="main"
          className="mx-auto max-w-7xl px-4 pt-8 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-8 lg:py-10"
        >
          {props.children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={props.groups}
        businesses={props.businesses}
        currentTenantId={props.tenantId}
        labels={labels.palette}
        themeLabels={labels.themes}
        onTheme={changeTheme}
        onHelp={() => window.dispatchEvent(new Event(HELP_OPEN_EVENT))}
        helpLabel={labels.help}
        extra={[
          { label: labels.vaConsole, href: "/va" },
          ...(props.user.isPlatformOwner
            ? [{ label: labels.platformAdmin, href: "/platform/setup" }]
            : []),
        ]}
      />
      <MobileTabBar
        tenantId={props.tenantId}
        labels={{ nav: labels.nav, ...labels.tabs }}
        onMore={() => setDrawerOpen(true)}
      />
      <HelpWidget tenantId={props.tenantId} aboveTabBar />
    </div>
  );
}
