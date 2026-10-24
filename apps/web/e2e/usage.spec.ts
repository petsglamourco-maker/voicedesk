// A business sees this month's usage against its monthly allowance (ADR 0022). By default the
// allowance comes from the plan and businesses don't set their own limits. Free: no AI request.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("an owner sees usage against the plan's monthly allowance", async ({ page }) => {
  await signUpWithBusiness(page, `Usage Co ${Date.now()}`);
  await page.getByRole("link", { name: "Usage & limits" }).click();
  await expect(page.getByRole("heading", { name: "Usage & limits" })).toBeVisible();
  await expect(page.getByTestId("usage-cards").getByText("Within limit")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Your monthly allowance" })).toBeVisible();
  await expect(page.getByText(/Your allowance comes from your plan/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save limits" })).toHaveCount(0);
});
