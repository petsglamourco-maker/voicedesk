import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { waitForEmailLink } from "./mailpit";

// Phase 4 journey: turn on website chat → a visitor chats → the conversation appears in the
// Inbox → a person takes over and replies. Works with or without a real AI provider.
test("website chat conversations reach the inbox, where staff can take over", async ({ page }) => {
  test.setTimeout(180_000);
  const run = randomUUID().slice(0, 8);
  const email = `p4-${run}@example.com`;

  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("Robin Owner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.goto(await waitForEmailLink(email, /Verify your VoiceDesk email/));
  await page.getByLabel("Business name").fill(`Chatty Cafe ${run}`);
  await page.getByRole("button", { name: "Create business" }).click();
  await expect(page.getByRole("heading", { name: `Chatty Cafe ${run}` })).toBeVisible();

  // Turn on website chat and use the preview as a visitor.
  await page.getByRole("link", { name: "Website chat", exact: true }).click();
  await expect(page.getByTestId("widget-snippet")).toContainText("data-key=");
  await page.getByRole("button", { name: "Turn on" }).click();
  const chat = page.frameLocator('iframe[title="Preview"]');
  await expect(chat.locator("#log")).toContainText("AI", { timeout: 20_000 });
  await page.waitForTimeout(1600); // the widget ignores instant (bot-like) sends
  await chat.getByLabel("Type your message…").fill("Hello, are you open on Sundays?");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.locator(".msg.agent")).toHaveCount(2, { timeout: 60_000 });

  // The conversation is in the inbox.
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  const threads = page.getByTestId("inbox-threads");
  await expect(threads.getByRole("button")).toHaveCount(1, { timeout: 20_000 });
  await threads.getByRole("button").first().click();
  const transcript = page.getByTestId("inbox-transcript");
  await expect(transcript).toContainText("open on Sundays");

  // A person takes over by replying.
  await page.getByLabel("Reply").fill("Hi, Robin here. Yes, 10am to 2pm on Sundays.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(transcript).toContainText("Robin here");
  await expect(page.getByText("A person is replying")).toBeVisible();
  await page.getByRole("button", { name: "Hand back to assistant" }).click();
  await expect(page.getByText("Assistant replying")).toBeVisible();
});
