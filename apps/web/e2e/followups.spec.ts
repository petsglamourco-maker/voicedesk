// Follow-ups and questions to answer (ADR 0026). Free: no AI request, nothing is sent.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("an owner switches on follow-ups and sees questions to answer", async ({ page }) => {
  const tenantId = await signUpWithBusiness(page, `Follow Co ${Date.now()}`);

  await page.goto(`/t/${tenantId}/agent`);
  const toggle = page.getByRole("checkbox", {
    name: /Offer a follow-up when an enquiry doesn't book/,
  });
  await toggle.check();
  await page.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: /Offer a follow-up when an enquiry doesn't book/ }),
  ).toBeChecked();

  await page.goto(`/t/${tenantId}/knowledge`);
  const questions = page.getByTestId("questions-to-answer");
  await expect(questions.getByRole("heading", { name: "Questions to answer" })).toBeVisible();
  await expect(questions.getByText(/Nothing to answer right now/)).toBeVisible();
});
