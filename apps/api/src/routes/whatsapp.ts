import { timingSafeEqual } from "node:crypto";
import { parseWhatsAppWebhook } from "@voicedesk/adapters/messaging/whatsapp-cloud";
import { resolvePublicEndpoint } from "@voicedesk/agent-brain";
import {
  channelThreads,
  conversationMessages,
  publicEndpoints,
  tenants,
  withPlatformAccess,
  withTenant,
} from "@voicedesk/db";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import QRCode from "qrcode";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { verifyHmacSignature } from "../lib/webhooks";
import { requireTenantAccess } from "./guards";
import type { ChannelSender } from "./inbox";
import { requirePlatformOwner } from "./platform";

/** Meta only allows free-form messages within 24 h of the customer's last message. */
export const WHATSAPP_WINDOW_MS = 24 * 3600 * 1000;

interface WhatsAppConfig {
  displayNumber?: string;
}

export interface WhatsAppSettings {
  accessToken: string | null;
  appSecret: string | null;
  verifyToken: string | null;
}

/** Constant-time comparison of a shared secret (security audit, low). */
function sameSecret(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function whatsAppSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppSettings {
  return {
    accessToken: env.WHATSAPP_ACCESS_TOKEN || null,
    appSecret: env.WHATSAPP_APP_SECRET || null,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || null,
  };
}

/** Staff replies from the inbox, inside WhatsApp's 24-hour customer-service window. */
export function whatsAppSender(
  deps: Pick<AppDeps, "db">,
  send: (phoneNumberId: string, to: string, text: string) => Promise<void>,
): ChannelSender {
  return {
    async send({ tenantId, threadId, externalId, text, authorName }) {
      const { endpoint, lastFromCustomer } = await withTenant(deps.db, tenantId, async (tx) => {
        const [endpoint] = await tx
          .select()
          .from(publicEndpoints)
          .where(and(eq(publicEndpoints.tenantId, tenantId), eq(publicEndpoints.kind, "whatsapp")));
        const [thread] = await tx
          .select()
          .from(channelThreads)
          .where(eq(channelThreads.id, threadId));
        const [last] = thread?.conversationId
          ? await tx
              .select({ at: conversationMessages.createdAt })
              .from(conversationMessages)
              .where(
                and(
                  eq(conversationMessages.conversationId, thread.conversationId),
                  eq(conversationMessages.role, "caller"),
                ),
              )
              .orderBy(desc(conversationMessages.id))
              .limit(1)
          : [];
        return { endpoint, lastFromCustomer: last?.at };
      });
      if (!endpoint)
        throw new HttpError(409, "WHATSAPP_NOT_SET_UP", "No WhatsApp number for this business");
      if (!lastFromCustomer || Date.now() - lastFromCustomer.getTime() > WHATSAPP_WINDOW_MS) {
        throw new HttpError(
          409,
          "WHATSAPP_WINDOW_CLOSED",
          "WhatsApp only allows replies within 24 hours of the customer's last message. They need to message you first.",
        );
      }
      await send(endpoint.key, externalId, `${authorName}: ${text}`);
    },
  };
}

export function registerWhatsAppRoutes(app: FastifyInstance, deps: AppDeps): void {
  const settings = deps.whatsapp ?? whatsAppSettingsFromEnv();

  // Webhook: Meta signs the raw body, so this route parses JSON itself.
  void app.register((scope, _opts, done) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
      done(null, body);
    });

    scope.get("/api/webhooks/whatsapp", async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      if (
        q["hub.mode"] === "subscribe" &&
        settings.verifyToken &&
        sameSecret(q["hub.verify_token"], settings.verifyToken)
      ) {
        return reply.type("text/plain").send(q["hub.challenge"] ?? "");
      }
      return reply.status(403).send("Forbidden");
    });

    scope.post("/api/webhooks/whatsapp", async (request, reply) => {
      const raw = typeof request.body === "string" ? request.body : "";
      const header = String(request.headers["x-hub-signature-256"] ?? "");
      const signature = header.startsWith("sha256=") ? header.slice(7) : "";
      if (
        !settings.appSecret ||
        !verifyHmacSignature({ secret: settings.appSecret, payload: raw, signature })
      ) {
        return reply.status(401).send({ error: "invalid signature" });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return reply.status(400).send({ error: "invalid JSON" });
      }
      for (const message of parseWhatsAppWebhook(payload)) {
        const endpoint = await resolvePublicEndpoint(deps.db, "whatsapp", message.phoneNumberId);
        if (!endpoint?.enabled) continue;
        await deps.jobs.dispatchChannel({
          kind: "whatsapp.inbound",
          tenantId: endpoint.tenantId,
          phoneNumberId: message.phoneNumberId,
          from: message.from,
          profileName: message.profileName,
          messageId: message.messageId,
          text: message.text,
        });
      }
      // Always 200 quickly: Meta retries anything else.
      return reply.status(200).send({ ok: true });
    });
    done();
  });

  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["whatsapp"];

  r.get(
    "/api/platform/whatsapp-numbers",
    { schema: { tags, summary: "WhatsApp numbers and the businesses they belong to" } },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      return withPlatformAccess(
        deps.db,
        { actorUserId: session.user.id, reason: "list whatsapp numbers" },
        async (tx) => ({
          numbers: (
            await tx.select().from(publicEndpoints).where(eq(publicEndpoints.kind, "whatsapp"))
          ).map((e) => ({
            id: e.id,
            tenantId: e.tenantId,
            phoneNumberId: e.key,
            displayNumber: (e.config as WhatsAppConfig).displayNumber ?? null,
            enabled: e.enabled,
          })),
          tenants: await tx.select({ id: tenants.id, name: tenants.name }).from(tenants),
          configured: Boolean(settings.accessToken && settings.appSecret && settings.verifyToken),
        }),
      );
    },
  );

  r.post(
    "/api/platform/whatsapp-numbers",
    {
      schema: {
        tags,
        summary: "Connect a WhatsApp number (phone-number id from Meta) to a business",
        body: z.object({
          tenantId: z.string().uuid(),
          phoneNumberId: z.string().regex(/^\d{6,30}$/, "The phone number ID is all digits"),
          displayNumber: z
            .string()
            .transform((s) => s.replace(/[\s()-]/g, ""))
            .pipe(
              z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +447700900123"),
            ),
        }),
      },
    },
    async (request, reply) => {
      const session = await requirePlatformOwner(deps, request);
      const existing = await resolvePublicEndpoint(deps.db, "whatsapp", request.body.phoneNumberId);
      if (existing)
        throw new HttpError(409, "NUMBER_EXISTS", "This WhatsApp number is already connected");
      const [row] = await withPlatformAccess(
        deps.db,
        { actorUserId: session.user.id, reason: "connect whatsapp number" },
        (tx) =>
          tx
            .insert(publicEndpoints)
            .values({
              tenantId: request.body.tenantId,
              kind: "whatsapp",
              key: request.body.phoneNumberId,
              config: { displayNumber: request.body.displayNumber },
            })
            .returning(),
      );
      return reply.status(201).send({ id: row!.id });
    },
  );

  r.delete(
    "/api/platform/whatsapp-numbers/:id",
    {
      schema: {
        tags,
        summary: "Disconnect a WhatsApp number",
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const session = await requirePlatformOwner(deps, request);
      const removed = await withPlatformAccess(
        deps.db,
        { actorUserId: session.user.id, reason: "disconnect whatsapp number" },
        (tx) =>
          tx
            .delete(publicEndpoints)
            .where(
              and(eq(publicEndpoints.id, request.params.id), eq(publicEndpoints.kind, "whatsapp")),
            )
            .returning({ id: publicEndpoints.id }),
      );
      if (removed.length === 0) throw notFound();
      return reply.status(204).send();
    },
  );

  r.get(
    "/api/tenants/:tenantId/whatsapp",
    {
      schema: {
        tags,
        summary: "The business's WhatsApp number, click-to-chat link and QR code",
        params: z.object({ tenantId: z.string() }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "tenant:read",
      );
      const [endpoint] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select()
          .from(publicEndpoints)
          .where(
            and(
              eq(publicEndpoints.tenantId, access.tenantId),
              eq(publicEndpoints.kind, "whatsapp"),
            ),
          ),
      );
      const displayNumber = (endpoint?.config as WhatsAppConfig | undefined)?.displayNumber;
      if (!endpoint || !displayNumber) return { connected: false as const };
      const link = `https://wa.me/${displayNumber.replace(/\D/g, "")}`;
      return {
        connected: true as const,
        displayNumber,
        link,
        qrSvg: await QRCode.toString(link, { type: "svg", margin: 1, width: 240 }),
      };
    },
  );
}
