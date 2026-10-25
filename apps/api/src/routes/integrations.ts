import { createHash, createHmac } from "node:crypto";
import {
  CALENDAR_PROVIDERS,
  can,
  chooseCalendar,
  createOAuthState,
  decryptRefreshToken,
  deleteCalendarConnection,
  getCalendarConnection,
  getMembershipRole,
  isBusinessRole,
  isCalendarProvider,
  recordAudit,
  saveCalendarConnection,
  toConnectionView,
  updateRefreshToken,
  verifyOAuthState,
  type CalendarProviderKey,
} from "@voicedesk/core";
import { withTenant } from "@voicedesk/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { requireSession, requireTenantAccess } from "./guards";

const params = z.object({ tenantId: z.string() });
const providerParams = params.extend({ provider: z.enum(CALENDAR_PROVIDERS) });
const NONCE_COOKIE = "vd_oauth_nonce";

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function setNonceCookie(reply: FastifyReply, value: string, maxAge: number, secure: boolean): void {
  reply.header(
    "set-cookie",
    `${NONCE_COOKIE}=${encodeURIComponent(value)}; Path=/api/integrations; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
  );
}

/**
 * PKCE (security audit M7): the code verifier is derived from the one-use nonce in the
 * HttpOnly cookie, so a stolen authorization code is useless without both.
 */
function pkceVerifier(secret: string, nonce: string): string {
  return createHmac("sha256", secret).update(`pkce:${nonce}`).digest("base64url");
}
const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

/** Calendar integrations: Google Calendar and Microsoft 365 (ADR 0014). */
export function registerIntegrationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["integrations"];
  const oauth = deps.calendars?.oauth ?? {};
  const box = deps.secrets.box;
  const secureCookie = (deps.webOrigin ?? "").startsWith("https://");

  function requireProvider(provider: CalendarProviderKey) {
    const client = oauth[provider];
    if (!client) {
      throw new HttpError(
        503,
        "CALENDAR_NOT_CONFIGURED",
        `${provider === "google" ? "Google Calendar" : "Microsoft 365"} isn't configured on this server`,
      );
    }
    if (!box) {
      throw new HttpError(
        503,
        "ENCRYPTION_NOT_CONFIGURED",
        "SETTINGS_ENCRYPTION_KEY is missing, so calendar access can't be stored safely",
      );
    }
    return { client, box };
  }

  async function connectedCalendar(tenantId: string) {
    const row = await getCalendarConnection(deps.db, tenantId);
    if (!row || !box || !deps.calendars?.factory) throw notFound();
    const provider = deps.calendars.factory(row, decryptRefreshToken(box, row), (token) =>
      updateRefreshToken(deps.db, box, row, token),
    );
    return { row, provider };
  }

  r.get(
    "/api/tenants/:tenantId/integrations",
    {
      schema: {
        tags,
        summary: "The connected calendar and which providers are available",
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
        calendar: {
          available: Object.fromEntries(
            CALENDAR_PROVIDERS.map((p) => [p, oauth[p] !== undefined && box !== null]),
          ) as Record<CalendarProviderKey, boolean>,
          canManage: can(access.role, "agent:configure"),
          connection: row ? toConnectionView(row) : null,
        },
      };
    },
  );

  r.get(
    "/api/tenants/:tenantId/integrations/:provider/start",
    {
      schema: {
        tags,
        summary: "Redirects to Google or Microsoft to connect a calendar",
        params: providerParams,
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const { client } = requireProvider(request.params.provider);
      const existing = await getCalendarConnection(deps.db, access.tenantId);
      if (existing && existing.provider !== request.params.provider) {
        throw new HttpError(
          409,
          "OTHER_CALENDAR_CONNECTED",
          "Another calendar is already connected. Disconnect it first.",
        );
      }
      const { state, nonce } = createOAuthState(deps.oauthStateSecret, {
        tenantId: access.tenantId,
        userId: access.session.user.id,
        provider: request.params.provider,
      });
      setNonceCookie(reply, nonce, 600, secureCookie);
      const challenge = pkceChallenge(pkceVerifier(deps.oauthStateSecret, nonce));
      return reply.redirect(client.authorizeUrl(state, challenge), 302);
    },
  );

  r.get(
    "/api/integrations/:provider/callback",
    {
      schema: {
        tags,
        summary: "OAuth redirect target",
        params: z.object({ provider: z.enum(CALENDAR_PROVIDERS) }),
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const session = await requireSession(deps.auth, request);
      const nonce = readCookie(request, NONCE_COOKIE);
      const parsed = request.query.state
        ? verifyOAuthState(deps.oauthStateSecret, request.query.state, nonce)
        : null;
      setNonceCookie(reply, "", 0, secureCookie); // one use only
      // The person finishing the flow must be the one who started it, for this provider.
      if (
        !parsed ||
        parsed.userId !== session.user.id ||
        parsed.provider !== request.params.provider
      ) {
        throw new HttpError(
          400,
          "INVALID_OAUTH_STATE",
          "This connection link has expired. Please try again.",
        );
      }
      const role = await getMembershipRole(deps.db, session.user.id, parsed.tenantId);
      if (!role || !isBusinessRole(role) || !can(role, "agent:configure")) throw notFound();
      const provider = request.params.provider;
      const back = `/t/${parsed.tenantId}/integrations`;
      if (request.query.error || !request.query.code) {
        return reply.redirect(`${back}?calendar=cancelled`, 302);
      }
      const { client, box: secretBox } = requireProvider(provider);
      try {
        const tokens = await client.exchangeCode(
          request.query.code,
          pkceVerifier(deps.oauthStateSecret, nonce ?? ""),
        );
        if (!tokens.refreshToken) {
          return reply.redirect(`${back}?calendar=no_refresh_token`, 302);
        }
        await saveCalendarConnection(deps.db, secretBox, {
          tenantId: parsed.tenantId,
          provider,
          userId: session.user.id,
          refreshToken: tokens.refreshToken,
          accountEmail: tokens.email,
        });
        // Use the account's main calendar straight away, so bookings work without an extra
        // step (it can still be changed on the Integrations page). Never fails the connection.
        try {
          const { provider: cal } = await connectedCalendar(parsed.tenantId);
          const primary = ((await cal.listCalendars?.()) ?? []).find((c) => c.primary);
          if (primary) await chooseCalendar(deps.db, parsed.tenantId, primary);
        } catch (error) {
          request.log.warn({ err: error, provider }, "choosing the primary calendar failed");
        }
        await withTenant(deps.db, parsed.tenantId, (tx) =>
          recordAudit(tx, {
            tenantId: parsed.tenantId,
            actorType: "user",
            actorUserId: session.user.id,
            action: "integration.calendar_connected",
            metadata: { provider },
          }),
        );
        return reply.redirect(`${back}?calendar=connected`, 302);
      } catch (error) {
        request.log.error({ err: error, provider }, "calendar oauth exchange failed");
        return reply.redirect(`${back}?calendar=failed`, 302);
      }
    },
  );

  r.get(
    "/api/tenants/:tenantId/integrations/calendar/calendars",
    { schema: { tags, summary: "Calendars the connected account can write to", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const { provider } = await connectedCalendar(access.tenantId);
      try {
        return { calendars: (await provider.listCalendars?.()) ?? [] };
      } catch (error) {
        request.log.warn({ err: error }, "listing calendars failed");
        throw new HttpError(
          502,
          "CALENDAR_UNAVAILABLE",
          "The calendar service didn't respond. Try reconnecting.",
        );
      }
    },
  );

  r.put(
    "/api/tenants/:tenantId/integrations/calendar",
    {
      schema: {
        tags,
        summary: "Choose the calendar bookings go into",
        params,
        body: z.object({ id: z.string().min(1).max(500) }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const { provider } = await connectedCalendar(access.tenantId);
      const calendars = (await provider.listCalendars?.()) ?? [];
      const chosen = calendars.find((c) => c.id === request.body.id);
      if (!chosen) throw new HttpError(400, "UNKNOWN_CALENDAR", "That calendar isn't available");
      const updated = await chooseCalendar(deps.db, access.tenantId, chosen);
      return toConnectionView(updated!);
    },
  );

  r.delete(
    "/api/tenants/:tenantId/integrations/calendar",
    {
      schema: {
        tags,
        summary: "Disconnect the calendar (revokes access where the provider allows)",
        params,
      },
    },
    async (request, reply) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const row = await getCalendarConnection(deps.db, access.tenantId);
      if (!row) throw notFound();
      const client = isCalendarProvider(row.provider) ? oauth[row.provider] : undefined;
      if (client && box) {
        await client.revoke(decryptRefreshToken(box, row)).catch(() => undefined);
      }
      await deleteCalendarConnection(deps.db, access.tenantId);
      await withTenant(deps.db, access.tenantId, (tx) =>
        recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "integration.calendar_disconnected",
          metadata: { provider: row.provider },
        }),
      );
      return reply.status(204).send();
    },
  );
}
