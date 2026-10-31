// Automatic phone numbers (ADR 0032). Free: a trial business can't buy, so nothing is spent.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("the Phone numbers screen explains that numbers come with a paid plan", async ({ page }) => {
  const tenantId = await signUpWithBusiness(page, `Numbers Co ${Date.now()}`);
  await page.getByRole("link", { name: "Phone numbers" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/t/${tenantId}/numbers`));
  await expect(page.getByText(/Your own number comes with a paid plan/)).toBeVisible();
  await expect(page.getByText(/0 in use · 1 included in your plan · 0 extra/)).toBeVisible();
  await expect(page.getByText(/£5\.00 a month for a local number/)).toBeVisible();
});
