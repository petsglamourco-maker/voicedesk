import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  loadAgentContext,
  resolvePublicEndpoint,
  type PublicEndpoint,
} from "@voicedesk/agent-brain";
import { recordAudit } from "@voicedesk/core";
import { publicEndpoints, withTenant } from "@voicedesk/db";
import type { ChannelJob } from "@voicedesk/jobs";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { requireTenantAccess } from "./guards";

/**
 * Form capture (Phase 4): the hosted enquiry form (/f/<key>) and a webhook for forms the
 * business already has (Typeform, Jotform, Webflow…). Submissions are triaged by the workers.
 */

type FormSubmission = Extract<ChannelJob, { kind: "form.submitted" }>["form"];

export interface FormConfig {
  /** Shared secret for the webhook (sent as ?secret= or the X-VoiceDesk-Secret header). */
  secret?: string;
  title?: string;
  intro?: string;
  /** Which of the incoming fields hold the name, email, phone and message. */
  fieldMap?: Partial<Record<"name" | "email" | "phone" | "message" | "consent", string>>;
}

const params = z.object({ tenantId: z.string() });
const newKey = () => `fm_${randomBytes(18).toString("base64url")}`;
const newSecret = () => `fs_${randomBytes(24).toString("base64url")}`;
const MIN_FILL_MS = 2500;

/** Guesses for common form builders when no mapping is set. */
const GUESS: Record<"name" | "email" | "phone" | "message", RegExp> = {
  name: /^(your[_ -]?)?(full[_ -]?)?name$/i,
  email: /e-?mail/i,
  phone: /phone|mobile|tel/i,
  message: /message|enquiry|inquiry|comment|details|question/i,
};

/** Top-level fields (and one level of nesting, e.g. Webflow's `data`) as short strings. */
export function flattenFields(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (Object.keys(out).length >= 50) return;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        const text = String(v).trim();
        if (text && key.length <= 100) out[key] = text.slice(0, 4000);
      } else if (depth === 0) visit(v, 1);
    }
  };
  visit(body, 0);
  return out;
}

const truthy = (v: string | undefined) =>
  v !== undefined && /^(true|yes|on|1|agreed?|checked)$/i.test(v.trim());

export function mapFields(
  fields: Record<string, string>,
  map: FormConfig["fieldMap"] = {},
): Omit<FormSubmission, "submissionId" | "source"> {
  const used = new Set<string>();
  const pick = (kind: keyof typeof GUESS) => {
    const key = map[kind] ?? Object.keys(fields).find((k) => !used.has(k) && GUESS[kind].test(k));
    if (!key || fields[key] === undefined) return null;
    used.add(key);
    return fields[key];
  };
  const email = pick("email");
  const phone = pick("phone");
  const name = pick("name");
  const message = pick("message") ?? "";
  const consentKey = map.consent;
  if (consentKey) used.add(consentKey);
  const extra = Object.fromEntries(Object.entries(fields).filter(([k]) => !used.has(k)));
  return {
    name,
    email: email && z.string().email().safeParse(email).success ? email : null,
    phone,
    message,
    extra,
    // Sending an enquiry asks for a reply, unless the form has a consent box that wasn't ticked.
    contactConsent: consentKey ? truthy(fields[consentKey]) : true,
    marketingConsent: false,
  };
}

function secretMatches(expected: string | undefined, given: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerFormRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ownOrigin = deps.webOrigin ?? "http://localhost:3000";

  async function endpointFor(key: string): Promise<PublicEndpoint> {
    const endpoint = await resolvePublicEndpoint(deps.db, "form", key);
    if (!endpoint || !endpoint.enabled) throw notFound();
    return endpoint;
  }

  async function submit(endpoint: PublicEndpoint, form: FormSubmission) {
    await deps.jobs.dispatchChannel({ kind: "form.submitted", tenantId: endpoint.tenantId, form });
  }

  // ---- Public side (no sign-in) ----

  r.get(
    "/api/public/forms/:key",
    {
      schema: {
        tags: ["public forms"],
        summary: "What the hosted enquiry form shows",
        params: z.object({ key: z.string().max(64) }),
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const endpoint = await endpointFor(request.params.key);
      const config = endpoint.config as FormConfig;
      const ctx = await loadAgentContext(deps.db, endpoint.tenantId, "chat");
      return {
        businessName: ctx.businessName,
        title: config.title || null,
        intro: config.intro || null,
        /** Turnstile site key when the bot check is on (ADR 0022). */
        siteKey: deps.humanCheck?.siteKey ?? null,
      };
    },
  );

  r.post(
    "/api/public/forms/:key",
    {
      schema: {
        tags: ["public forms"],
        summary: "Submit the hosted enquiry form",
        params: z.object({ key: z.string().max(64) }),
        body: z
          .object({
            name: z.string().trim().min(1).max(100),
            email: z.string().trim().email().max(254).optional().or(z.literal("")),
            phone: z.string().trim().max(30).optional(),
            message: z.string().trim().min(1).max(4000),
            consent: z.literal(true),
            marketing: z.boolean().default(false),
            /** Honeypot: hidden from people, filled in by bots. */
            website: z.string().max(200).optional(),
            elapsedMs: z.number().int().min(0),
            /** Bot-check token (Cloudflare Turnstile), when the check is switched on. */
            human: z.string().max(2048).optional(),
          })
          .refine((b) => Boolean(b.email || b.phone), {
            message: "Give an email address or a phone number",
          }),
      },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (request.headers.origin !== ownOrigin) throw notFound();
      const endpoint = await endpointFor(request.params.key);
      const body = request.body;
      // Bots: pretend it worked so they don't adapt.
      if (body.website || body.elapsedMs < MIN_FILL_MS)
        return reply.code(202).send({ received: true });
      if (deps.humanCheck) {
        const verdict = await deps.humanCheck.verify(body.human ?? "", request.ip);
        if (verdict === "bot") {
          throw new HttpError(403, "HUMAN_CHECK_FAILED", "Please confirm you're not a robot");
        }
        if (verdict === "unavailable") request.log.warn("bot check unavailable; form allowed");
      }
      await submit(endpoint, {
        submissionId: randomUUID(),
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        message: body.message,
        extra: {},
        contactConsent: true,
        marketingConsent: body.marketing,
        source: "hosted",
      });
      return reply.code(202).send({ received: true });
    },
  );

  // Many form tools post classic HTML form encoding. Only this webhook accepts it: elsewhere
  // a form-encoded body is refused, so a page on another site can't post an HTML form to a
  // signed-in user's API (security audit M1).
  app.register((scope, _opts, done) => {
    scope.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 64 * 1024 },
      (_req, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      },
    );
    scope.withTypeProvider<ZodTypeProvider>().post(
      "/api/webhooks/forms/:key",
      {
        schema: {
          tags: ["public forms"],
          summary: "Receive a submission from an existing form (JSON or form-encoded)",
          params: z.object({ key: z.string().max(64) }),
          querystring: z.object({ secret: z.string().max(100).optional() }),
        },
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      },
      async (request, reply) => {
        const endpoint = await endpointFor(request.params.key);
        const config = endpoint.config as FormConfig;
        // The header is preferred: secrets in URLs end up in logs and browser history
        // (security audit M6). The ?secret= form still works for existing forms.
        const header = request.headers["x-voicedesk-secret"];
        const given = typeof header === "string" ? header : request.query.secret;
        if (!secretMatches(config.secret, given)) throw notFound();
        if (typeof header !== "string") request.log.warn("form webhook secret sent in the URL");
        // A form tool's retries carry the same key, so the enquiry is handled once.
        // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- reviewed: anchored/bounded pattern without nested quantifiers: linear time
        const idem = request.headers["idempotency-key"];
        const submissionId =
          typeof idem === "string" && /^[\w.:-]{8,120}$/.test(idem) ? `key:${idem}` : randomUUID();
        const mapped = mapFields(flattenFields(request.body), config.fieldMap);
        if (
          !mapped.message &&
          !mapped.email &&
          !mapped.phone &&
          !Object.keys(mapped.extra).length
        ) {
          throw new HttpError(400, "EMPTY_SUBMISSION", "No form fields received");
        }
        await submit(endpoint, { ...mapped, submissionId, source: "webhook" });
        return reply.code(202).send({ received: true });
      },
    );
    done();
  });

  // ---- Settings ----

  const tags = ["forms"];
  const base = ownOrigin;

  async function ensureEndpoint(tenantId: string) {
    return withTenant(deps.db, tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(publicEndpoints)
        .where(and(eq(publicEndpoints.tenantId, tenantId), eq(publicEndpoints.kind, "form")));
      if (existing) return existing;
      const [created] = await tx
        .insert(publicEndpoints)
        .values({
          tenantId,
          kind: "form",
          key: newKey(),
          enabled: false,
          config: { secret: newSecret() } satisfies FormConfig,
        })
        .returning();
      return created!;
    });
  }

  const view = (row: typeof publicEndpoints.$inferSelect) => {
    const config = row.config as FormConfig;
    return {
      key: row.key,
      enabled: row.enabled,
      title: config.title ?? "",
      intro: config.intro ?? "",
      fieldMap: config.fieldMap ?? {},
      hostedUrl: `${base}/f/${row.key}`,
      webhookPath: `/api/webhooks/forms/${row.key}?secret=${config.secret ?? ""}`,
      /** Recommended: the address without the secret, and the secret in this header. */
      webhookUrlPath: `/api/webhooks/forms/${row.key}`,
      secretHeader: { name: "X-VoiceDesk-Secret", value: config.secret ?? "" },
    };
  };

  r.get(
    "/api/tenants/:tenantId/forms",
    { schema: { tags, summary: "Form capture settings", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      return view(await ensureEndpoint(access.tenantId));
    },
  );

  const field = z.string().trim().max(100).optional();
  r.put(
    "/api/tenants/:tenantId/forms",
    {
      schema: {
        tags,
        summary: "Update form capture settings",
        params,
        body: z.object({
          enabled: z.boolean(),
          title: z.string().trim().max(80),
          intro: z.string().trim().max(500),
          fieldMap: z.object({
            name: field,
            email: field,
            phone: field,
            message: field,
            consent: field,
          }),
        }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const row = await ensureEndpoint(access.tenantId);
      const fieldMap = Object.fromEntries(
        Object.entries(request.body.fieldMap).filter(([, v]) => Boolean(v)),
      );
      const config: FormConfig = {
        ...(row.config as FormConfig),
        title: request.body.title || undefined,
        intro: request.body.intro || undefined,
        fieldMap,
      };
      const [updated] = await withTenant(deps.db, access.tenantId, async (tx) => {
        await recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "forms.settings_updated",
          metadata: { enabled: request.body.enabled },
        });
        return tx
          .update(publicEndpoints)
          .set({
            enabled: request.body.enabled,
            config: config as Record<string, unknown>,
            updatedAt: new Date(),
          })
          .where(eq(publicEndpoints.id, row.id))
          .returning();
      });
      return view(updated!);
    },
  );

  r.post(
    "/api/tenants/:tenantId/forms/regenerate",
    {
      schema: {
        tags,
        summary: "New form address and webhook secret (the old ones stop working)",
        params,
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const row = await ensureEndpoint(access.tenantId);
      const [updated] = await withTenant(deps.db, access.tenantId, async (tx) => {
        await recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "forms.key_regenerated",
          metadata: {},
        });
        return tx
          .update(publicEndpoints)
          .set({
            key: newKey(),
            config: { ...(row.config as FormConfig), secret: newSecret() },
            updatedAt: new Date(),
          })
          .where(eq(publicEndpoints.id, row.id))
          .returning();
      });
      return view(updated!);
    },
  );
}
