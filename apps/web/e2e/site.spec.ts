// The public website (ADR 0030). Free: nothing is sent; the calculator runs in the browser.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("signed out, the home page explains the service, prices and savings", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Never miss another customer.");
  const pricing = page.getByTestId("pricing");
  for (const price of ["£29", "£79", "£219"]) await expect(pricing).toContainText(price);

  const saving = page.getByTestId("saving");
  await expect(saving).toHaveText("£27,361");
  await page.getByLabel("Hourly pay (£)").fill("14");
  await expect(saving).not.toHaveText("£27,361");

  // ADR 0031: prices in the visitor's currency; the savings stay in pounds.
  await page.getByTestId("currency-picker").getByRole("link", { name: "$ USD" }).click();
  await expect(pricing).toContainText("$99");
  await expect(page.getByTestId("saving")).toContainText("£");

  await page.getByRole("link", { name: "Start free trial" }).first().click();
  await expect(page).toHaveURL(/\/sign-up/);
});

test("signed in, the home page still goes straight to the business", async ({ page }) => {
  const tenantId = await signUpWithBusiness(page, `Home Co ${Date.now()}`);
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/t/${tenantId}`));
  // /website always shows the website, signed in or not.
  await page.goto("/website");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Never miss another customer.");
});
