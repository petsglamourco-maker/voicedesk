// The owner sees this month's usage and sets their own monthly limits (ADR 0022). Free: no
// AI request, no texts or calls.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("an owner sets the business's monthly limits", async ({ page }) => {
  const tenantId = await signUpWithBusiness(page, `Usage Co ${Date.now()}`);
  await page.getByRole("link", { name: "Usage & limits" }).click();
  await expect(page.getByRole("heading", { name: "Usage & limits" })).toBeVisible();
  const cards = page.getByTestId("usage-cards");
  await expect(cards.getByText("Within limit")).toHaveCount(3);

  await page.getByLabel("AI limit (£ per month)").fill("15");
  await page.getByLabel("Texts limit (£ per month)").fill("0");
  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText("Limits saved.")).toBeVisible();
  // A £0 texts limit switches texts off, so it shows as reached.
  await expect(cards.getByText("Limit reached")).toHaveCount(1);

  await page.goto(`/t/${tenantId}/usage`);
  await expect(page.getByLabel("AI limit (£ per month)")).toHaveValue("15.00");
});
