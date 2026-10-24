import type { FastifyInstance } from "fastify";

/**
 * Where browsers send Content-Security-Policy violation reports (security audit M4). While the
 * policy is report-only, these show what enforcing it would break. Only the directive and the
 * blocked resource's origin are logged: never full URLs (they can carry tokens or PII).
 */
interface LegacyReport {
  "csp-report"?: {
    "violated-directive"?: string;
    "effective-directive"?: string;
    "blocked-uri"?: string;
  };
}
interface ReportingApiReport {
  type?: string;
  body?: { effectiveDirective?: string; blockedURL?: string };
}

function originOnly(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.includes(":")) return value; // "inline", "eval", "self"
  try {
    return new URL(value).origin;
  } catch {
    return value.split(":")[0] ?? null;
  }
}

export function registerCspReportRoute(app: FastifyInstance): void {
  app.register((scope, _opts, done) => {
    for (const type of ["application/csp-report", "application/reports+json"]) {
      scope.addContentTypeParser(
        type,
        { parseAs: "string", bodyLimit: 16 * 1024 },
        (_r, body, done) => {
          try {
            done(null, JSON.parse(body as string));
          } catch {
            done(null, null);
          }
        },
      );
    }
    scope.post(
      "/api/csp-report",
      { schema: { hide: true }, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const body = request.body as LegacyReport | ReportingApiReport[] | null;
        const reports = Array.isArray(body)
          ? body
              .filter((r) => r.type === "csp-violation")
              .map((r) => ({
                directive: r.body?.effectiveDirective,
                blocked: originOnly(r.body?.blockedURL),
              }))
          : body?.["csp-report"]
            ? [
                {
                  directive:
                    body["csp-report"]["effective-directive"] ??
                    body["csp-report"]["violated-directive"],
                  blocked: originOnly(body["csp-report"]["blocked-uri"]),
                },
              ]
            : [];
        for (const r of reports.slice(0, 10)) request.log.warn({ csp: r }, "csp violation");
        return reply.code(204).send();
      },
    );
    done();
  });
}
