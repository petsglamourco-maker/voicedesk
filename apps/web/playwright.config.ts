import { defineConfig, devices } from "@playwright/test";

// Requires `pnpm infra:up` (Postgres, Redis, Mailpit). Reuses already-running dev servers.
const repoRoot = "../..";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // `next dev` stalls page loads when more fresh browsers start heavy journeys at once.
  workers: process.env.CI ? undefined : 2,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @voicedesk/api start",
      cwd: repoRoot,
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @voicedesk/workers start",
      cwd: repoRoot,
      url: "http://127.0.0.1:4100",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @voicedesk/web dev",
      cwd: repoRoot,
      url: "http://127.0.0.1:3000/sign-in",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
