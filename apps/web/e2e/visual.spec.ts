// Visual regression for the "Aurora Glow" design system (DESIGN.md): the /design gallery and
// the sign-in page, dark and light, phone and desktop. Fixture content only, so it's stable.
// Uses a throwaway account (the /design gallery is open to any signed-in user in development).
// Update baselines after an intended change: pnpm --filter @voicedesk/web test:e2e visual --update-snapshots
import { expect, test, type Page } from "@playwright/test";
import { signUpVerified } from "./accounts";

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
      await context.addCookies([{ name: "vd-theme", value: mode, url: "http://localhost:3000" }]);
      await page.setViewportSize({ width, height: 900 });
      await signUpVerified(page);
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
