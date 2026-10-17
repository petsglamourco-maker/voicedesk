import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Applies migrations to the test database once per run.
    globalSetup: ["../../packages/db/test/global-setup.ts"],
    testTimeout: 20_000,
  },
});
