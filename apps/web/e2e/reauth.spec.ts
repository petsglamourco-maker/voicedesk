// Sensitive team changes ask for the password again (security audit H6). Inviting an admin
// sends one email to Mailpit; no AI request.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, signUpWithBusiness } from "./accounts";

test("inviting an admin asks for the password, then sends the invite", async ({ page }) => {
  await signUpWithBusiness(page, `Reauth Co ${Date.now()}`);
  await page.getByRole("link", { name: "Team" }).click();
  const email = `e2e-admin-${randomUUID().slice(0, 8)}@example.com`;
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Role").selectOption("admin");
  await page.getByRole("button", { name: "Send invitation" }).click();

  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Password").fill("not-the-password");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog.getByText("That password isn't right.")).toBeVisible();

  await dialog.getByLabel("Password").fill(E2E_PASSWORD);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Invitation sent to ${email}.`)).toBeVisible();
});
