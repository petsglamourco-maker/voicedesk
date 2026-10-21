# DESIGN.md — "Aurora Glow"

Luminous, premium and calm. **Dark first** (dark is the default and the showcase), with a
fully designed light mode. Live gallery: **`/design`** (signed-in platform owner), showing
every token and component in both modes.

## Rules

1. **Tokens only.** Colours come from `apps/web/src/app/globals.css` (`bg-primary`,
   `text-muted-foreground`, `var(--color-ch-whatsapp)`…). No hex values or `bg-white` in
   components. The one exception is a business's own widget colour (white-labelling).
2. **Colour is never the only signal.** Status pills, trends and channels always carry an icon
   or text as well.
3. **Contrast is tested.** `apps/web/src/lib/contrast.test.ts` checks every text/background pair
   in both modes against WCAG 2.2 AA:
   - text needs 4.5:1, including on glass, on tinted badges and alerts;
   - borders, the focus ring and chart marks need 3:1.

   It also checks that the `system` and `light` blocks match. If you change a token, run
   `pnpm --filter @voicedesk/web test`.

4. **Motion is calm.** Animations are spring-like and take 200–400 ms (`--ease-spring`).
   Loops are reserved for live things (the aurora, a ringing call, the latest data point).
   `prefers-reduced-motion` stops every animation: they jump to their end state and number
   tickers show the final value.
5. **Glass has fallbacks.** `.glass` falls back to a solid surface when `backdrop-filter` is
   unsupported or the user prefers reduced transparency.
6. **Presentation only.** A design change never changes routes, data, APIs or behaviour. If one
   would, ask first.
7. **Logical CSS and `dir="auto"`** on user and agent text, for right-to-left languages.
   Strings go in `apps/web/messages/en.json`.

## Theme

- `<html data-theme="dark|light|system">` comes from the `vd-theme` cookie, so the first paint
  is already correct.
- The theme can be changed in the account menu, the command palette (Ctrl/Cmd+K) or `/design`.
- Dark tokens live in `@theme`; light tokens in `[data-theme="light"]`, copied under
  `[data-theme="system"]` for `prefers-color-scheme: light`.

## Tokens

| Token                                                         | Dark                                    | Light                                   | Use                                                                         |
| ------------------------------------------------------------- | --------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| background                                                    | `#070B14`                               | `#F6F8FC`                               | page                                                                        |
| surface / surface-raised                                      | `#0F1626` / `#152036`                   | `#FFFFFF`                               | solid cards, popovers                                                       |
| glass                                                         | `rgb(15 22 38 / .7)`                    | `rgb(255 255 255 / .8)`                 | frosted cards (blur 20px)                                                   |
| foreground / muted-foreground                                 | `#E8EEF9` / `#94A3B8`                   | `#0B1220` / `#475569`                   | text                                                                        |
| border / input                                                | `#1E293B` / `#64748B`                   | `#E2E8F0` / `#64748B`                   | dividers / control borders (3:1)                                            |
| primary (teal)                                                | `#2DD4BF` on `#04211D`                  | `#0F766E` on white                      | main actions, focus ring, glow                                              |
| secondary (blue)                                              | `#60A5FA`                               | `#1D4ED8`                               | links, secondary data                                                       |
| accent (magenta)                                              | `#E879F9`                               | `#A21CAF`                               | highlights, AI moments                                                      |
| info / success / warning / danger                             | `#38BDF8` `#34D399` `#FBBF24` `#F87171` | `#0369A1` `#047857` `#92400E` `#B91C1C` | status                                                                      |
| aurora-1/2/3                                                  | teal / blue / magenta                   | pale washes                             | background blobs only                                                       |
| ch-voice, ch-outbound, ch-web, ch-whatsapp, ch-email, ch-form |                                         |                                         | one colour per touchpoint (WhatsApp official `#25D366`, `#128C7E` in light) |

The light-mode secondary, warning, success, info, accent and danger are each one shade
darker than the brief, so small text and badge text pass 4.5:1.

**Type.** Sora (`font-display`) for headings and numbers; Manrope (`font-sans`) for the
interface. Both are self-hosted through `next/font`.

- Page titles are 32–36 px.
- KPI numbers are 40–56 px; the hero number uses the `.text-aurora` gradient.
- Numbers use `.tabular`.

**Shape.** Radii are 8 / 12 / 16 / 20 px (`rounded-sm` to `rounded-xl`; cards use `xl`).
Spacing follows an 8-pt rhythm.

**Effects.**

- `.glass`: frosted surface;
- `.aurora-border`: the signature, a slowly turning aurora edge for hero surfaces (one per screen at most);
- `.spotlight` and `.dot-grid`: light from a corner and a faint star-dot texture, for hero cards;
- `.grain`: film grain over the aurora background, so big gradients don't band;
- `.glow`: teal halo;
- `.text-aurora`;
- animations: `animate-aurora`, `animate-glow-pulse`, `animate-shimmer`, `animate-draw` (chart lines), `animate-bar-grow`, `animate-gauge` and `animate-rise` (staggered entrance of bento tiles). Reduced motion also cancels animation delays, so nothing stays hidden.

## Components (`@voicedesk/ui`)

| Group    | Components                                                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actions  | `Button` (primary · secondary · ghost · link · danger · accent; sm · md · lg · icon; pill)                                                                      |
| Forms    | `Input`, `Textarea`, `Select`, `Label`, `Field` (label + hint + inline error), `Switch`, `Checkbox`, `RadioGroup`                                               |
| Surfaces | `Card` (glass · solid · hero · ghost), `CardTitle`, `CardDescription`, `PageHeader`, `AuroraBackground`                                                         |
| Status   | `Badge` (tones), `StatusPill` (icon + optional live pulse), `Alert`, toasts (`sonner`'s `toast()`)                                                              |
| Overlays | `Dialog`, `DrawerContent`, `useConfirm()` (styled replacement for `window.confirm`), `Tooltip`, `DropdownMenu*`, `Popover*`, `Tabs*`                            |
| Data     | `DataTable` (sticky header, sort of loaded rows, density toggle, empty state), `KpiCard`, `NumberTicker`, `Progress`, `Avatar`, `Kbd`, `Skeleton`, `EmptyState` |
| Moments  | `Reveal` (staggered entrance), `Celebrate` (burst of light for wins)                                                                                            |

**Charts** (`apps/web/src/components/charts.tsx`):

- server-rendered SVG: `AreaChart` (hero), `RadialGauge`, `StackedBars`, `LineChart`, `Sparkline`, `Donut`, `Heatmap`, `BarList`, `Funnel`, `ShareBar`;
- styling: gradient fills, rounded bars that grow in, smooth monotone curves (never dip below zero) that draw in with a glow, a pulsing latest point;
- pass a smaller `width` for phones (render a `sm:hidden` copy) so axis text stays readable; gradient ids include the width, because Chrome ignores gradients defined in a hidden copy;
- put `[&>*]:min-w-0` on grids that hold charts, or wide charts push the page sideways on phones;
- gradient ids are derived from the data (server components can't use `useId`).

**App shell** (`apps/web/src/components/shell/`):

- collapsible sidebar (a drawer on mobile);
- top bar with search;
- the Ctrl/Cmd+K command palette;
- notifications (waiting chats, ringing calls);
- account menu with the theme switch.

## Building a screen

Every screen follows the same recipe, so the app feels like one product:

1. **Header:** `ScreenHero` (`apps/web/src/components/screen-hero.tsx`) with the page's menu icon and its menu group as the eyebrow. It's the signature `PageHero`: aurora edge, corner light, star dots and a glowing icon orb. Put page-level numbers in it as `HeroStat` chips, and period switches or main buttons in `actions`. Use one hero per screen.
2. **Root:** `<div className="stagger space-y-6">`, so sections rise in one after another.
3. **Cards:** `Card` with `CardHead` (a tinted icon chip, title and hint) instead of a bare title. Tint by meaning:
   - channel pages use their channel colour;
   - warnings use `warning`;
   - assistant features use `accent`.
4. **Channels:** `ChannelDot` (`apps/web/src/components/channels.tsx`), never emoji. Labels come from `dashboard.touchpoint.*`.
5. **People:** `Avatar`. **Status:** `StatusPill` with an icon (`live` for things happening now) or `Badge tone`. Never hand-colour a badge.
6. **Empty lists:** `EmptyState` with one next step.
7. **Grids** that hold charts or tables get `[&>*]:min-w-0`.
8. **Relative times** in client components use `useNow()`; in server components pass `new Date()`.

**Frames:**

- `AppShell` for business screens;
- `StandaloneShell` for the VA console and Platform admin;
- `AuthShell` for sign-in, sign-up, onboarding and invites;
- `PublicCard` for pages customers see (hosted form, rating). It carries no VoiceDesk brand, because the business is the brand there.

`loading.tsx` and `error.tsx` under `t/[tenantId]` give every business screen a content-shaped skeleton and a friendly retry.

## Checks

- `pnpm verify`, which includes the contrast test.
- `pnpm --filter @voicedesk/web test:e2e visual` runs Playwright visual regression of `/design` and sign-in (dark/light × 375/1440, reduced motion). After an intended change, add `--update-snapshots` and review the new images.
- `node apps/web/scripts/screens.mjs <label> [filter]` takes review screenshots of every screen at 375/768/1440 in both modes, saved to `.design-shots/` (git-ignored).
