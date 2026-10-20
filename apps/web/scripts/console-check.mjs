// Dev helper: prints browser console errors/warnings for a page (signed in as the platform owner).
// Usage: node apps/web/scripts/console-check.mjs [url]
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning")
    logs.push(`${m.type()}: ${m.text().slice(0, 400)}`);
});
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message.slice(0, 400)}`));
await page.goto("http://localhost:3000/sign-in");
await page.getByLabel(/email/i).fill(env.PLATFORM_OWNER_EMAIL);
await page.getByLabel(/password/i).fill(env.PLATFORM_OWNER_PASSWORD);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(/\/t\//);
await page.goto(process.argv[2] ?? "http://localhost:3000/t/5e2d8e81-4cb1-4a4c-891e-af4f18e21db2", {
  waitUntil: "networkidle",
});
await page.waitForTimeout(1500);
console.log(logs.join("\n") || "no errors");
await browser.close();
