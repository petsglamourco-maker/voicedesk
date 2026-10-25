// Warms the Next.js dev server before parallel tests: when several fresh browsers ask for the
// same uncompiled client chunks at once, some requests can stall until the test times out.
import { chromium, type FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const path of ["/sign-in", "/sign-up", "/forgot-password", "/design"]) {
      await page.goto(new URL(path, baseURL).toString(), { timeout: 180_000 });
    }
  } finally {
    await browser.close();
  }
}
