import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["../db/test/global-setup.ts"],
    testTimeout: 30_000,
  },
});
