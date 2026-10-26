// Voice typing (ADR 0027): the microphone shows in text fields, and both switches hide it.
// Free: the microphone is never pressed, so no Deepgram token is made.
import { expect, test } from "@playwright/test";
import { signUpWithBusiness } from "./accounts";

test("the microphone shows on Ask VoiceDesk, and the business and personal switches hide it", async ({
  page,
}) => {
  const tenantId = await signUpWithBusiness(page, `Mic Co ${Date.now()}`);

  await page.goto(`/t/${tenantId}/account`);
  const card = page.getByTestId("voice-typing-settings");
  await expect(card.getByRole("heading", { name: "Voice typing" })).toBeVisible();
  test.skip(
    await card.getByText(/isn't set up/).isVisible(),
    "Deepgram isn't configured on this machine",
  );

  await page.goto(`/t/${tenantId}/ask`);
  await expect(page.getByTestId("mic-button")).toBeVisible();

  // The business switches it off for everyone.
  await page.goto(`/t/${tenantId}/agent`);
  const business = page.getByRole("checkbox", { name: /Voice typing in text fields/ });
  await business.uncheck();
  await page.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await page.goto(`/t/${tenantId}/ask`);
  await expect(page.getByRole("textbox").first()).toBeVisible();
  await expect(page.getByTestId("mic-button")).toHaveCount(0);

  // Back on for the business, then off just for me.
  await page.goto(`/t/${tenantId}/agent`);
  await page.getByRole("checkbox", { name: /Voice typing in text fields/ }).check();
  await page.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await page.goto(`/t/${tenantId}/account`);
  const personal = page.getByRole("checkbox", { name: /Show the microphone in text fields/ });
  await expect(personal).toBeChecked();
  await personal.click();
  await expect(personal).not.toBeChecked();
  await expect(personal).toBeEnabled();
  await page.goto(`/t/${tenantId}/ask`);
  await expect(page.getByRole("textbox").first()).toBeVisible();
  await expect(page.getByTestId("mic-button")).toHaveCount(0);
});
