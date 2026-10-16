import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { defineConfig } from "drizzle-kit";

loadRootEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: requireEnv("DATABASE_OWNER_URL") },
  strict: true,
  verbose: true,
});
