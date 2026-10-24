// Throwaway accounts for e2e: sign up, verify through Mailpit, optionally create a business.
// (Never the real platform owner: that account has two-step login.)
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { waitForEmailLink } from "./mailpit";

export const E2E_PASSWORD = "e2e-password-123";

export async function signUpVerified(page: Page, name = "E2E Tester"): Promise<string> {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await waitForEmailLink(email, /Verify your VoiceDesk email/));
  return email;
}

/** Signs up and creates a business; returns its id (the page is on its Dashboard). */
export async function signUpWithBusiness(page: Page, business: string): Promise<string> {
  await signUpVerified(page);
  await expect(page.getByRole("heading", { name: "Add your business" })).toBeVisible();
  await page.getByLabel("Business name").fill(business);
  await page.getByRole("button", { name: "Create business" }).click();
  await expect(page.getByRole("heading", { name: business })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2]!;
}
