import { defineConfig } from "vitest/config";

// Unit tests only; Playwright owns e2e/.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
