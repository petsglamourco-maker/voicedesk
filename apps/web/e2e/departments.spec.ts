// Departments and the phone menu (ADR 0025): an owner sets up "press 1 for Sales, 2 for
// Support" and sees what callers will hear. Free: no AI request, no call.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("an owner sets up the phone menu and previews it", async ({ page }) => {
  await signUpWithBusiness(page, `Menu Co ${Date.now()}`);
  await page.getByRole("link", { name: "Departments & menu" }).click();
  await expect(page.getByRole("heading", { name: "Departments & phone menu" })).toBeVisible();

  await page.getByRole("button", { name: "Add department" }).click();
  await page.getByLabel("Department", { exact: true }).first().fill("Sales");
  await page.getByRole("button", { name: "Add department" }).click();
  await page.getByLabel("Department", { exact: true }).nth(1).fill("Support");
  await page.getByLabel("Instructions for the assistant").fill("Ask for the order number first.");
  await page.getByRole("switch", { name: "Play the menu after the greeting" }).click();
  await page.getByRole("button", { name: "Save menu" }).click();

  await expect(page.getByText("Menu saved.")).toBeVisible();
  await expect(page.getByTestId("menu-preview")).toContainText(
    "For Sales, press 1. For Support, press 2. Or just tell me what you need.",
  );
  await page.reload();
  await expect(page.getByLabel("Department", { exact: true }).nth(1)).toHaveValue("Support");
});
