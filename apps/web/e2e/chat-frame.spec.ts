// The website chat frame starts a session with its signed token (security audit M3). Free:
// nothing is sent to the assistant, so no AI request.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("the chat frame opens a session with its own token", async ({ page }) => {
  const tenantId = await signUpWithBusiness(page, `Frame Co ${Date.now()}`);
  const key = await page.evaluate(async (id) => {
    const get = await fetch(`/api/tenants/${id}/widget`);
    const { key } = (await get.json()) as { key: string };
    await fetch(`/api/tenants/${id}/widget`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        allowedOrigins: ["https://shop.example.com"],
        color: "#0f766e",
        title: "Frame Co chat",
        position: "right",
      }),
    });
    return key;
  }, tenantId);

  const session = page.waitForResponse((r) => r.url().endsWith(`/chat/${key}/session`));
  await page.goto(`/api/public/chat/${key}/frame`);
  expect((await session).status()).toBe(200);
  await expect(page.getByText(/AI assistant/).first()).toBeVisible();
  await expect(page.getByText("Chat is unavailable right now.")).toHaveCount(0);
});

test("website chat offers department buttons; tapping one picks it (no AI request)", async ({
  page,
}) => {
  const tenantId = await signUpWithBusiness(page, `Chat Menu Co ${Date.now()}`);
  const key = await page.evaluate(async (id) => {
    const get = await fetch(`/api/tenants/${id}/widget`);
    const { key } = (await get.json()) as { key: string };
    await fetch(`/api/tenants/${id}/widget`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        allowedOrigins: ["https://shop.example.com"],
        color: "#0f766e",
        title: "Chat Menu Co",
        position: "right",
      }),
    });
    await fetch(`/api/tenants/${id}/departments`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        menuEnabled: false,
        menuHours: "always",
        menuOnChat: true,
        departments: [
          { key: 1, name: "Sales" },
          { key: 2, name: "Support" },
        ],
      }),
    });
    return key;
  }, tenantId);

  await page.goto(`/api/public/chat/${key}/frame`);
  await page.getByRole("button", { name: "Support" }).click();
  await expect(page.getByText("You're through to Support. How can I help?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sales" })).toHaveCount(0);
});
