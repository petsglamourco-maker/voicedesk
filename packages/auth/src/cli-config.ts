// Used only by `pnpm generate-schema` (Better Auth CLI) to emit the Drizzle auth schema.
import { createDb } from "@voicedesk/db";
import { createAuth } from "./index";

export const auth = createAuth({
  db: createDb("postgres://unused@localhost/unused"),
  baseURL: "http://localhost:3000",
  secret: "schema-generation-only-secret-not-used-at-runtime",
  trustedOrigins: [],
  sendEmail: () => Promise.resolve(),
  audit: () => Promise.resolve(),
});
