import type { FastifyInstance } from "fastify";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Cross-site request forgery check (security audit M1): every change must come from
 * VoiceDesk's own pages (Origin, or Referer when a browser leaves Origin out). Webhooks are
 * server-to-server and carry their own signatures or secrets; Better Auth checks Origin
 * against its trusted origins itself; CSP reports change nothing.
 */
export function registerOriginCheck(app: FastifyInstance, webOrigins: string | string[]): void {
  const allowed = new Set(Array.isArray(webOrigins) ? webOrigins : [webOrigins]);
  app.addHook("onRequest", async (request, reply) => {
    if (!UNSAFE.has(request.method)) return;
    const path = request.url.split("?")[0] ?? "";
    if (
      path.startsWith("/api/webhooks/") ||
      path.startsWith("/api/auth/") ||
      path === "/api/csp-report" // browsers send reports without our Origin
    ) {
      return;
    }
    const origin = originOf(request.headers.origin) ?? originOf(request.headers.referer);
    if (origin && allowed.has(origin)) return;
    return reply
      .status(403)
      .send({ error: "CROSS_SITE", message: "This request must come from VoiceDesk's own pages" });
  });
}

const PRIVATE_V4 = /^(10\.\d+|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+$/;

/**
 * EXTRA_WEB_ORIGINS (ADR 0024): more addresses the web app is opened on, for testing on a
 * phone over home Wi-Fi (`pnpm mobile:lan`). Only https origins on a private network
 * address or a .local name are accepted, so this can't be used to trust a public site.
 */
export function parseExtraOrigins(raw: string | undefined): string[] {
  const origins: string[] = [];
  for (const entry of (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`EXTRA_WEB_ORIGINS: "${entry}" isn't a web address`);
    }
    const host = url.hostname;
    if (url.protocol !== "https:" || !(PRIVATE_V4.test(host) || host.endsWith(".local"))) {
      throw new Error(
        `EXTRA_WEB_ORIGINS: "${entry}" must be https on a home-network address (e.g. https://192.168.1.20:8443)`,
      );
    }
    origins.push(url.origin);
  }
  return origins;
}
