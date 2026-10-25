import { loadRootEnv } from "@voicedesk/config/load-env";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

loadRootEnv();

const apiUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const https = webOrigin.startsWith("https://");
const dev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy (security audit M4), in report-only mode first: nothing is blocked,
 * violations are sent to /api/csp-report so we can see what would break, then enforce.
 * Pages need Next's inline bootstrap scripts ('unsafe-inline' until nonces); dev also needs
 * eval for fast refresh. LiveKit (voice) and Cloudflare Turnstile (bot check) are the only
 * outside services the browser talks to.
 */
function livekitOrigins(): string[] {
  try {
    const url = new URL(process.env.LIVEKIT_URL ?? "");
    const host = url.host;
    return [`wss://${host}`, `https://${host}`];
  } catch {
    return [];
  }
}
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${livekitOrigins().join(" ")}${dev ? " ws: wss:" : ""}`.trim(),
  "media-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "report-uri /api/csp-report",
].join("; ");

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
          // Only VoiceDesk's own pages may use the microphone (browser calls, VA console).
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
          },
          ...(https
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
      {
        // Everything except the website chat frame, which businesses embed on their own sites
        // (the API sends its own frame-ancestors for it).
        source: "/((?!api/public/chat/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
    ]);
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
