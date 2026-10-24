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
export function registerOriginCheck(app: FastifyInstance, webOrigin: string): void {
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
    if (origin === webOrigin) return;
    return reply
      .status(403)
      .send({ error: "CROSS_SITE", message: "This request must come from VoiceDesk's own pages" });
  });
}
