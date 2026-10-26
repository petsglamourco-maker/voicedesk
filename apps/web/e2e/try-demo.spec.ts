// Instant demo (ADR 0029). Free: demos are off by default, so nothing is crawled or spent.
import { expect, test } from "@playwright/test";

test("the public /try page opens without signing in and says when demos are off", async ({
  page,
}) => {
  await page.goto("/try");
  await expect(page.getByRole("heading", { name: "Hear your own AI receptionist" })).toBeVisible();
  // The dev database keeps demos switched off unless the platform owner turned them on.
  const off = page.getByTestId("demo-off");
  const form = page.getByTestId("demo-form");
  await expect(off.or(form)).toBeVisible();
  if (await form.isVisible()) {
    await expect(form.getByText(/deleted after 24 hours/)).toBeVisible();
    await expect(form.getByText(/DeepSeek in China/)).toBeVisible();
  }
});
