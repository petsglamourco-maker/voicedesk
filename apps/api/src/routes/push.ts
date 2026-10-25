import { isPushEndpoint } from "@voicedesk/adapters";
import { describeDevice } from "@voicedesk/auth/devices";
import { endpointHash, savePushSubscription, sendPush } from "@voicedesk/core";
import { pushSubscriptions } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError } from "../lib/errors";
import { requireSession } from "./guards";

/**
 * Push notifications on this device (ADR 0024). A subscription belongs to the person and
 * the current sign-in; signing out removes it. Only browsers' push services are accepted
 * as endpoints, because the server sends to them.
 */

const b64url = z
  .string()
  .min(16)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+=*$/);
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1024).refine(isPushEndpoint, "Not a browser push service"),
  keys: z.object({ p256dh: b64url, auth: b64url }),
});

export function registerPushRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const box = deps.secrets.box;

  r.get(
    "/api/me/push",
    {
      schema: {
        tags: ["account"],
        summary: "Whether push notifications are available, and on for this sign-in",
        response: {
          200: z.object({
            available: z.boolean(),
            publicKey: z.string().nullable(),
            devices: z.number(),
            thisSession: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      const rows = await deps.db
        .select({ sessionId: pushSubscriptions.sessionId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, session.user.id));
      return {
        available: Boolean(deps.push && box),
        publicKey: deps.push?.publicKey ?? null,
        devices: rows.length,
        thisSession: rows.some((row) => row.sessionId === session.session.id),
      };
    },
  );

  r.post(
    "/api/me/push",
    {
      schema: {
        tags: ["account"],
        summary: "Turn on push notifications for this device",
        body: z.object({ subscription: subscriptionSchema }),
      },
    },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      if (!deps.push || !box) {
        throw new HttpError(503, "PUSH_NOT_SET_UP", "Notifications aren't set up yet.");
      }
      const device = describeDevice(request.headers["user-agent"]);
      await savePushSubscription(deps.db, box, {
        userId: session.user.id,
        sessionId: session.session.id,
        subscription: request.body.subscription,
        deviceLabel: [device.browser, device.os].filter(Boolean).join(" on ") || null,
      });
      return { ok: true };
    },
  );

  r.delete(
    "/api/me/push",
    {
      schema: {
        tags: ["account"],
        summary: "Turn off push notifications for this device",
        body: z.object({ endpoint: z.string().max(1024).optional() }).optional(),
      },
    },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      const endpoint = request.body?.endpoint;
      await deps.db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, session.user.id),
            endpoint
              ? eq(pushSubscriptions.endpointHash, endpointHash(endpoint))
              : eq(pushSubscriptions.sessionId, session.session.id),
          ),
        );
      return { ok: true };
    },
  );

  r.post(
    "/api/me/push/test",
    {
      schema: { tags: ["account"], summary: "Send a test notification to my devices" },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request) => {
      const session = await requireSession(deps.auth, request);
      if (!deps.push || !box) {
        throw new HttpError(503, "PUSH_NOT_SET_UP", "Notifications aren't set up yet.");
      }
      const result = await sendPush({ db: deps.db, box, push: deps.push }, [session.user.id], {
        title: "VoiceDesk",
        body: "Notifications are working on this device.",
        path: "/today",
        tag: "test",
      });
      return result;
    },
  );
}
