// The Help assistant opens on any screen with starter questions, and Contact support can be
// opened and cancelled. Sends no AI request and no email (no question asked, nothing sent).
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("Help opens with starter questions; Contact support opens and cancels", async ({ page }) => {
  await signUpWithBusiness(page, `Help Co ${Date.now()}`);

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
