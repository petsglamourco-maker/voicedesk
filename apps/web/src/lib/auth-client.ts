"use client";

import { ac, roles } from "@voicedesk/auth/roles";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin: /api/auth/* is proxied to the API by next.config.ts rewrites.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [
    organizationClient({ ac, roles }),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = "/two-factor";
      },
    }),
  ],
});
