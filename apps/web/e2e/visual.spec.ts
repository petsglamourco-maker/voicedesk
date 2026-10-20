// Visual regression for the "Aurora Glow" design system (DESIGN.md): the /design gallery and
// the sign-in page, dark and light, phone and desktop. Fixture content only, so it's stable.
// Update baselines after an intended change: pnpm --filter @voicedesk/web test:e2e visual --update-snapshots
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const WIDTHS = [375, 1440];
const MODES = ["dark", "light"] as const;

test.use({ reducedMotion: "reduce" });

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

for (const mode of MODES) {
  for (const width of WIDTHS) {
    test(`sign-in ${mode} ${width}`, async ({ page, context }) => {
      await context.addCookies([{ name: "vd-theme", value: mode, url: "http://localhost:3000" }]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/sign-in");
      await settle(page);
      await expect(page).toHaveScreenshot(`sign-in-${mode}-${width}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });

    test(`design gallery ${mode} ${width}`, async ({ page, context }) => {
      test.skip(!env.PLATFORM_OWNER_EMAIL, "needs the platform owner in .env");
      await context.addCookies([{ name: "vd-theme", value: mode, url: "http://localhost:3000" }]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/sign-in?redirect=/design");
      await page.getByLabel(/email/i).fill(env.PLATFORM_OWNER_EMAIL!);
      await page.getByLabel(/password/i).fill(env.PLATFORM_OWNER_PASSWORD!);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
      await page.goto("/design");
      await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`design-${mode}-${width}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });
  }
}
