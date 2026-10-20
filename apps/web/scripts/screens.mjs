// Design review screenshots (not a test): every screen at 375 / 768 / 1440 px in dark and
// light mode, for before/after comparison during the "Aurora Glow" upgrade.
//
// Usage (dev servers running): node apps/web/scripts/screens.mjs <label> [filter]
//   → .design-shots/<label>/<screen>-<scheme>-<width>.png  (git-ignored)
// Signs in as the platform owner from .env; reads nothing else from it.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const label = process.argv[2] ?? "current";
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const out = join(root, ".design-shots", label);
mkdirSync(out, { recursive: true });
const base = env.WEB_ORIGIN || "http://localhost:3000";
const tenant = process.env.SHOTS_TENANT ?? "5e2d8e81-4cb1-4a4c-891e-af4f18e21db2";
const t = (p) => `/t/${tenant}${p}`;

const screens = [
  ["sign-in", "/sign-in", false],
  ["sign-up", "/sign-up", false],
  ["dashboard", t("")],
  ["inbox", t("/inbox")],
  ["ask", t("/ask")],
  ["knowledge", t("/knowledge")],
  ["profile", t("/profile")],
  ["assistant", t("/agent")],
  ["integrations", t("/integrations")],
  ["website-chat", t("/website-chat")],
  ["whatsapp", t("/whatsapp")],
  ["email", t("/email")],
  ["forms", t("/forms")],
  ["console", t("/console")],
  ["calls", t("/calls")],
  ["contacts", t("/contacts")],
  ["records", t("/records")],
  ["feedback", t("/feedback")],
  ["members", t("/members")],
  ["account", t("/account")],
  ["va-console", "/va"],
  ["onboarding", "/onboarding"],
  ["platform-ai", "/platform/ai"],
  ["platform-numbers", "/platform/phone-numbers"],
  ["platform-vas", "/platform/vas"],
  ["design", "/design"],
];

async function signIn(page) {
  await page.goto(`${base}/sign-in`);
  await page.getByLabel(/email/i).fill(env.PLATFORM_OWNER_EMAIL);
  await page.getByLabel(/password/i).fill(env.PLATFORM_OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/t\/|\/onboarding|two-factor/, { timeout: 30_000 });
}

const browser = await chromium.launch();
for (const scheme of ["dark", "light"]) {
  for (const width of [375, 768, 1440]) {
    const anon = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: scheme,
      reducedMotion: "reduce",
    });
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: scheme,
      reducedMotion: "reduce",
    });
    // The theme comes from the vd-theme cookie (dark by default), not the OS scheme.
    const themeCookie = [{ name: "vd-theme", value: scheme, url: base }];
    await ctx.addCookies(themeCookie);
    await anon.addCookies(themeCookie);
    const page = await ctx.newPage();
    await signIn(page);
    // Detail pages need an id from the API.
    const first = async (path, pick) => {
      const res = await page.request.get(`${base}/api/tenants/${tenant}${path}`);
      return res.ok() ? pick(await res.json()) : null;
    };
    const extra = [
      ["call-detail", await first("/calls", (d) => d.calls?.[0]?.id), (id) => t(`/calls/${id}`)],
      [
        "contact-detail",
        await first("/contacts", (d) => d.contacts?.[0]?.id),
        (id) => t(`/contacts/${id}`),
      ],
      ["inbox-thread", await first("/inbox", (d) => d.threads?.[0]?.id), (id) => t(`/inbox/${id}`)],
    ]
      .filter(([, id]) => id)
      .map(([name, id, path]) => [name, path(id)]);
    for (const [name, path, signedIn = true] of [...screens, ...extra]) {
      if (filter && !filter.test(name)) continue;
      const p = signedIn ? page : await anon.newPage();
      try {
        await p.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
        await p.screenshot({ path: join(out, `${name}-${scheme}-${width}.png`), fullPage: true });
      } catch (error) {
        console.error(`${name} ${scheme} ${width}: ${error.message.split("\n")[0]}`);
      }
      if (!signedIn) await p.close();
    }
    await ctx.close();
    await anon.close();
  }
}
await browser.close();
console.log(`screenshots in ${out}`);
