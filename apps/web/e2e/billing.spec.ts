// Plans and billing (ADR 0023): a new business is on the free trial and sees the plans.
// Free: no Stripe keys in dev, so the page says payments aren't switched on yet.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("a new business is on the 14-day trial and can compare plans", async ({ page }) => {
  await signUpWithBusiness(page, `Billing Co ${Date.now()}`);
  await page.getByRole("link", { name: "Usage & limits" }).click();
  await page.getByRole("link", { name: "See plans" }).click();
  await expect(page.getByRole("heading", { name: "Plan & billing", level: 1 })).toBeVisible();
  const current = page.getByTestId("current-plan");
  await expect(current.getByRole("heading", { name: "Your plan: Free trial" })).toBeVisible();
  await expect(current.getByText(/14 days left/)).toBeVisible();
  const cards = page.getByTestId("plan-cards");
  for (const name of ["Starter", "Growth", "Pro"]) {
    await expect(cards.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByTestId("plan-starter").getByText("WhatsApp")).toHaveCount(0);
  await expect(page.getByTestId("plan-growth").getByText("WhatsApp")).toBeVisible();
  await expect(page.getByText(/Prices exclude VAT/)).toBeVisible();
  // Without Stripe keys (dev), plans can't be bought yet.
  if (await page.getByTestId("billing-not-ready").isVisible()) {
    await expect(page.getByTestId("choose-growth")).toBeDisabled();
  }
});
