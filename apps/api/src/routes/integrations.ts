import {
  chooseCalendar,
  createOAuthState,
  decryptRefreshToken,
  deleteCalendarConnection,
  getCalendarConnection,
  recordAudit,
  saveGoogleConnection,
  toConnectionView,
  verifyOAuthState,
  can,
  getMembershipRole,
  isBusinessRole,
} from "@voicedesk/core";
import { withTenant } from "@voicedesk/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { requireSession, requireTenantAccess } from "./guards";

const params = z.object({ tenantId: z.string() });
const NONCE_COOKIE = "vd_oauth_nonce";

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function setNonceCookie(reply: FastifyReply, value: string, maxAge: number): void {
  reply.header(
    "set-cookie",
    `${NONCE_COOKIE}=${encodeURIComponent(value)}; Path=/api/integrations; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
  );
}

export function registerIntegrationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["integrations"];
  const google = deps.calendars?.oauth ?? null;
  const box = deps.secrets.box;

  function requireGoogle() {
    if (!google) {
      throw new HttpError(
        503,
        "GOOGLE_NOT_CONFIGURED",
        "Google Calendar isn't configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)",
      );
    }
    if (!box) {
      throw new HttpError(
        503,
        "ENCRYPTION_NOT_CONFIGURED",
        "SETTINGS_ENCRYPTION_KEY is missing, so calendar access can't be stored safely",
      );
    }
    return { google, box };
  }

  r.get(
    "/api/tenants/:tenantId/integrations",
    {
      schema: {
        tags,
        summary: "Connected calendars and whether each provider is available",
        params,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "tenant:read",
      );
      const row = await getCalendarConnection(deps.db, access.tenantId);
      return {
        google: {
          available: google !== null && box !== null,
          canManage: can(access.role, "agent:configure"),
          connection: row ? toConnectionView(row) : null,
        },
      };
    },
  );

  r.get(
    "/api/tenants/:tenantId/integrations/google/start",
    { schema: { tags, summary: "Redirects to Google to connect a calendar", params } },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const { google: oauth } = requireGoogle();
      const { state, nonce } = createOAuthState(
        deps.oauthStateSecret,
        access.tenantId,
        access.session.user.id,
      );
      setNonceCookie(reply, nonce, 600);
      return reply.redirect(oauth.authorizeUrl(state), 302);
    },
  );

  r.get(
    "/api/integrations/google/callback",
    {
      schema: {
        tags,
        summary: "Google OAuth redirect target",
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const session = await requireSession(deps.auth, request);
      const parsed = request.query.state
        ? verifyOAuthState(
            deps.oauthStateSecret,
            request.query.state,
            readCookie(request, NONCE_COOKIE),
          )
        : null;
      setNonceCookie(reply, "", 0); // one use only
      // The person finishing the flow must be the one who started it, still allowed to.
      if (!parsed || parsed.userId !== session.user.id) {
        throw new HttpError(
          400,
          "INVALID_OAUTH_STATE",
          "This connection link has expired. Please try again.",
        );
      }
      const role = await getMembershipRole(deps.db, session.user.id, parsed.tenantId);
      if (!role || !isBusinessRole(role) || !can(role, "agent:configure")) throw notFound();
      const back = `/t/${parsed.tenantId}/integrations`;
      if (request.query.error || !request.query.code) {
        return reply.redirect(`${back}?google=cancelled`, 302);
      }
      const { google: oauth, box: secretBox } = requireGoogle();
      try {
        const tokens = await oauth.exchangeCode(request.query.code);
        if (!tokens.refreshToken) {
          return reply.redirect(`${back}?google=no_refresh_token`, 302);
        }
        await saveGoogleConnection(deps.db, secretBox, {
          tenantId: parsed.tenantId,
          userId: session.user.id,
          refreshToken: tokens.refreshToken,
          accountEmail: tokens.email,
        });
        await withTenant(deps.db, parsed.tenantId, (tx) =>
          recordAudit(tx, {
            tenantId: parsed.tenantId,
            actorType: "user",
            actorUserId: session.user.id,
            action: "integration.google_connected",
          }),
        );
        return reply.redirect(`${back}?google=connected`, 302);
      } catch (error) {
        request.log.error({ err: error }, "google oauth exchange failed");
        return reply.redirect(`${back}?google=failed`, 302);
      }
    },
  );

  r.get(
    "/api/tenants/:tenantId/integrations/google/calendars",
    { schema: { tags, summary: "Calendars the connected Google account can write to", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const { box: secretBox } = requireGoogle();
      const row = await getCalendarConnection(deps.db, access.tenantId);
      if (!row || !deps.calendars?.factory) throw notFound();
      const provider = deps.calendars.factory(row, decryptRefreshToken(secretBox, row));
      try {
        return { calendars: (await provider.listCalendars?.()) ?? [] };
      } catch (error) {
        request.log.warn({ err: error }, "listing google calendars failed");
        throw new HttpError(502, "GOOGLE_UNAVAILABLE", "Google didn't respond. Try reconnecting.");
      }
    },
  );

  r.put(
    "/api/tenants/:tenantId/integrations/google/calendar",
    {
      schema: {
        tags,
        summary: "Choose the calendar bookings go into",
        params,
        body: z.object({ id: z.string().min(1).max(300) }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const { box: secretBox } = requireGoogle();
      const row = await getCalendarConnection(deps.db, access.tenantId);
      if (!row || !deps.calendars?.factory) throw notFound();
      const calendars =
        (await deps.calendars
          .factory(row, decryptRefreshToken(secretBox, row))
          .listCalendars?.()) ?? [];
      const chosen = calendars.find((c) => c.id === request.body.id);
      if (!chosen) throw new HttpError(400, "UNKNOWN_CALENDAR", "That calendar isn't available");
      const updated = await chooseCalendar(deps.db, access.tenantId, chosen);
      return toConnectionView(updated!);
    },
  );

  r.delete(
    "/api/tenants/:tenantId/integrations/google",
    { schema: { tags, summary: "Disconnect Google Calendar (revokes access)", params } },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const row = await getCalendarConnection(deps.db, access.tenantId);
      if (!row) throw notFound();
      if (google && box) {
        await google.revoke(decryptRefreshToken(box, row)).catch(() => undefined);
      }
      await deleteCalendarConnection(deps.db, access.tenantId);
      await withTenant(deps.db, access.tenantId, (tx) =>
        recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "integration.google_disconnected",
        }),
      );
      return reply.status(204).send();
    },
  );
}
