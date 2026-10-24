import { loadRootEnv } from "@voicedesk/config/load-env";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

loadRootEnv();

const apiUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@voicedesk/ui", "@voicedesk/auth"],
  poweredByHeader: false,
  // Keep the dev badge away from the Help button (bottom-right).
  devIndicators: { position: "bottom-left" },
  // The browser only ever talks to this origin; /api/* is proxied to the API service, so
  // auth cookies are first-party and no CORS is needed.
  rewrites() {
    return Promise.resolve([{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }]);
  },
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=()" },
        ],
      },
    ]);
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
