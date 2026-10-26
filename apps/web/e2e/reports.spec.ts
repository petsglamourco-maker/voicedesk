// Monthly value report and review requests (ADR 0028). Free: nothing is sent.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("the dashboard shows this month's value; settings preview the report and take a review link", async ({
  page,
}) => {
  const tenantId = await signUpWithBusiness(page, `Value Co ${Date.now()}`);

  await page.goto(`/t/${tenantId}`);
  const card = page.getByTestId("value-card");
  await expect(card.getByText("Your assistant this month")).toBeVisible();
  await expect(card.getByText("Conversations handled")).toBeVisible();

  await page.goto(`/t/${tenantId}/agent`);
  await page.getByLabel("Average booking value (£, optional)").fill("45");
  await page.getByLabel("Your review page (optional)").fill("https://g.page/r/value-co/review");
  await page.getByRole("checkbox", { name: /leave a public review/ }).check();
  await page.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();

  await page.getByRole("button", { name: "Preview last month's report" }).click();
  await expect(page.getByTestId("value-report-preview")).toContainText("Conversations handled");

  await page.reload();
  await expect(page.getByLabel("Average booking value (£, optional)")).toHaveValue("45");
  await expect(page.getByRole("checkbox", { name: /leave a public review/ })).toBeChecked();
});
