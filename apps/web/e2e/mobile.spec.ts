// The mobile web app (ADR 0024) at phone size: bottom tabs, Today, the full menu under More,
// and the installable-app files. Free: no AI request.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("phone layout: bottom tabs, Today and the menu", async ({ page }) => {
  const tenantId = await signUpWithBusiness(page, `Mobile Co ${Date.now()}`);
  const tabs = page.getByTestId("mobile-tabs");
  await expect(tabs).toBeVisible();

  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${tenantId}/today$`));
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByText("No bookings today.")).toBeVisible();
  await expect(page.getByTestId("today-chips").getByText("Chats waiting")).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");

  await tabs.getByRole("link", { name: "Inbox" }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${tenantId}/inbox`));

  await tabs.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Knowledge" })).toBeVisible();
});

test("the installed app opens on Today", async ({ page }) => {
  const tenantId = await signUpWithBusiness(page, `Start Co ${Date.now()}`);
  await page.goto("/today");
  await expect(page).toHaveURL(new RegExp(`/t/${tenantId}/today$`));
});

test("installable: manifest, service worker and offline page", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ start_url: "/today", display: "standalone" });
  const sw = await request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toContain("no-store");
  expect(await sw.text()).toContain("never pages or customer data");
  expect((await request.get("/offline")).ok()).toBe(true);
  expect((await request.get("/icons/icon-512.png")).ok()).toBe(true);
});
