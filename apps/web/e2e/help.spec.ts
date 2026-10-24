// The Help assistant opens on any screen with starter questions, and Contact support can be
// opened and cancelled. Sends no AI request and no email (no question asked, nothing sent).
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

test("Help opens with starter questions; Contact support opens and cancels", async ({ page }) => {
  test.skip(!env.PLATFORM_OWNER_EMAIL, "needs the platform owner in .env");
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(env.PLATFORM_OWNER_EMAIL!);
  await page.getByLabel(/password/i).fill(env.PLATFORM_OWNER_PASSWORD!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/t\//);

  // (In development, keep the Next.js dev badge bottom-left; it would cover this button.)
  await page.getByTestId("help-button").click();
  const panel = page.getByTestId("help-panel");
  await expect(panel.getByRole("heading", { name: "VoiceDesk Help" })).toBeVisible();
  await expect(panel.getByTestId("help-suggestions").getByRole("button").first()).toBeVisible();

  await panel.getByRole("button", { name: "Contact support" }).click();
  await expect(panel.getByLabel("Your message")).toBeVisible();
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByTestId("help-suggestions")).toBeVisible();

  // Esc closes it; "?" opens it again.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.keyboard.press("?");
  await expect(page.getByTestId("help-panel")).toBeVisible();
});
