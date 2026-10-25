// Forgot password → emailed link (Mailpit) → new password → every device signed out; the
// Account page then lists this device. No AI request; emails go to Mailpit only.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";
import { waitForEmailLink } from "./mailpit";

test("reset a forgotten password and see where you're signed in", async ({ page, browser }) => {
  const tenantId = await signUpWithBusiness(page, `Reset Co ${Date.now()}`);
  const email = await page.evaluate(async () => {
    const res = await fetch("/api/me");
    return ((await res.json()) as { user: { email: string } }).user.email;
  });

  // Another browser that isn't signed in asks for a reset link.
  const other = await (await browser.newContext()).newPage();
  await other.goto("/sign-in");
  await other.getByRole("link", { name: "Forgot password?" }).click();
  await expect(other.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await other.waitForLoadState("networkidle"); // the form works once the page has loaded
  await other.getByLabel("Email address").fill(email);
  await other.getByRole("button", { name: "Send reset link" }).click();
  await expect(other.getByText(/we've emailed a link/)).toBeVisible();

  await other.goto(await waitForEmailLink(email, /Reset your VoiceDesk password/));
  await expect(other.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await other.waitForLoadState("networkidle");
  const newPassword = "brand-new-e2e-password-9";
  await other.getByLabel("New password", { exact: true }).fill(newPassword);
  await other.getByLabel("Confirm new password").fill(newPassword);
  await other.getByRole("button", { name: "Save new password" }).click();
  await expect(other.getByText(/Every device has been signed out/)).toBeVisible();

  // The first browser was signed out by the reset.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // Sign in with the new password and check the Account page.
  await other.getByRole("link", { name: "Sign in" }).click();
  await expect(other.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await other.waitForLoadState("networkidle");
  await other.getByLabel("Email address").fill(email);
  await other.getByLabel("Password").fill(newPassword);
  await other.getByRole("button", { name: "Sign in" }).click();
  await other.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  await other.goto(`/t/${tenantId}/account`);
  const sessions = other.getByTestId("session-list");
  await expect(sessions.getByText("This device")).toBeVisible();
  await expect(sessions.getByRole("listitem")).toHaveCount(1);
});
