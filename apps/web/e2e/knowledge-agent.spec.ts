import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { waitForEmailLink } from "./mailpit";

// Phase 1 journey: add knowledge → approve a profile → talk to the agent.
// Works with or without an Anthropic key (assertions don't depend on the model's wording).
test("add knowledge, approve the profile and chat with the assistant", async ({ page }) => {
  test.setTimeout(180_000);
  const run = randomUUID().slice(0, 8);
  const email = `p1-${run}@example.com`;

  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("Pat Owner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.goto(await waitForEmailLink(email, /Verify your VoiceDesk email/));
  await page.getByLabel("Business name").fill(`Smile Studio ${run}`);
  await page.getByRole("button", { name: "Create business" }).click();
  await expect(page.getByRole("heading", { name: `Smile Studio ${run}` })).toBeVisible();

  // Knowledge: paste an FAQ and check retrieval finds it.
  await page.getByRole("link", { name: "Knowledge", exact: true }).click();
  await page.getByRole("tab", { name: "Text / FAQ" }).click();
  await page.getByLabel("Title").fill("Parking FAQ");
  await page
    .getByLabel("Text")
    .fill("# Parking\n\nThere is free parking for patients behind the building on Mill Lane.");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("source-list").getByText("Ready")).toBeVisible({ timeout: 90_000 });
  await page.getByPlaceholder("Do you have parking?").fill("Is there somewhere to park?");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Mill Lane").first()).toBeVisible();

  // Profile: fill in by hand and approve.
  await page.getByRole("link", { name: "Business profile" }).click();
  await page.getByLabel("What the business does").fill("Cosmetic and family dentistry.");
  await page.getByRole("button", { name: "+ Add service" }).click();
  await page.getByLabel("Service").fill("Check-up");
  await page.getByLabel("Price (as published)").fill("£50");
  await page.getByTestId("approve-profile").click();
  await expect(page.getByText(/Live: version 1/)).toBeVisible();

  // Test console: greeting discloses AI; a reply streams back.
  await page.getByRole("link", { name: "Test console" }).click();
  await page.getByRole("button", { name: "Start conversation" }).click();
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toContainText("the AI assistant here");
  await page.getByLabel("Your message").fill("Do you have parking?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(transcript.locator("text=/ms · \\$/")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "End & summarise" }).click();
  await expect(page.getByTestId("summary")).not.toContainText("Writing the summary", {
    timeout: 90_000,
  });

  // Calls: a text chat is not a call; no number assigned yet, forwarding help hidden.
  await page.getByRole("link", { name: "Calls", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Calls" })).toBeVisible();
  await expect(page.getByText("No calls yet.")).toBeVisible();
  await expect(page.getByText(/No phone number yet/)).toBeVisible();
  await expect(page.getByTestId("latency-median")).toHaveText("—");

  // Contacts and Integrations pages render.
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await page.getByRole("link", { name: "Integrations", exact: true }).click();
  await expect(page.getByTestId("calendar-integration")).toBeVisible();
});
