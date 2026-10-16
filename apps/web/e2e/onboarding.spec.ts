import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { waitForEmailLink } from "./mailpit";

const PASSWORD = "e2e-password-123";

async function signUpAndVerify(page: Page, name: string, email: string) {
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const link = await waitForEmailLink(email, /Verify your VoiceDesk email/);
  await page.goto(link);
}

async function createBusiness(page: Page, name: string): Promise<string> {
  await expect(page.getByRole("heading", { name: "Add your business" })).toBeVisible();
  await page.getByLabel("Business name").fill(name);
  await page.getByRole("button", { name: "Create business" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2]!;
}

test("sign up, create a business, invite staff who sees only that business", async ({
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const ownerEmail = `owner-${run}@example.com`;
  const staffEmail = `staff-${run}@example.com`;

  // ── Owner: sign up, verify, create two businesses ──────────────────────────
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto("/sign-up");
  await signUpAndVerify(owner, "Olivia Owner", ownerEmail);
  const otherTenant = await createBusiness(owner, `Other Co ${run}`);

  await owner.getByTestId("business-switcher").selectOption({ label: "+ Add another business" });
  const tenantId = await createBusiness(owner, `Bright Dental ${run}`);
  expect(tenantId).not.toBe(otherTenant);
  await expect(owner.getByText("Your role: Owner")).toBeVisible();
  await expect(owner.getByText("tenant.created")).toBeVisible();

  // ── Owner: invite a staff member ───────────────────────────────────────────
  await owner.getByRole("link", { name: "Team" }).click();
  await owner.getByLabel("Email address").fill(staffEmail);
  await owner.getByLabel("Role").selectOption("staff");
  await owner.getByRole("button", { name: "Send invitation" }).click();
  await expect(owner.getByText(`Invitation sent to ${staffEmail}.`)).toBeVisible();
  await expect(owner.getByTestId("invitation-list")).toContainText(staffEmail);

  // ── Staff: open invite, create account, verify, accept ─────────────────────
  const inviteLink = await waitForEmailLink(staffEmail, /invited to Bright Dental/);
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await staff.goto(inviteLink);
  await staff.getByRole("link", { name: "Create an account to accept" }).click();
  await signUpAndVerify(staff, "Sam Staff", staffEmail);

  await expect(staff.getByRole("heading", { name: `Join Bright Dental ${run}` })).toBeVisible();
  await staff.getByRole("button", { name: "Accept invitation" }).click();
  await expect(staff.getByRole("heading", { name: `Bright Dental ${run}` })).toBeVisible();
  await expect(staff.getByText("Your role: Staff")).toBeVisible();
  // Staff can't read the audit log.
  await expect(staff.getByText("Recent activity")).toHaveCount(0);

  // Staff only sees the business they were invited to.
  const options = await staff.getByTestId("business-switcher").locator("option").allTextContents();
  expect(options).toEqual([`Bright Dental ${run}`, "+ Add another business"]);

  // …and cannot open the owner's other business, even with its URL.
  const response = await staff.goto(`/t/${otherTenant}`);
  expect(response?.status()).toBe(404);

  // Staff sees the team read-only.
  await staff.goto(`/t/${tenantId}/members`);
  await expect(staff.getByText("Only owners and admins can manage the team.")).toBeVisible();
  await expect(staff.getByTestId("member-list")).toContainText(ownerEmail);

  // Owner now sees the staff member and the audit trail.
  await owner.reload();
  await expect(owner.getByTestId("member-list")).toContainText(staffEmail);
  await owner.getByRole("link", { name: "Overview" }).click();
  await expect(owner.getByText("member.joined")).toBeVisible();

  await ownerContext.close();
  await staffContext.close();
});
