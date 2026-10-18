import { randomBytes } from "node:crypto";
import { recordAudit } from "@voicedesk/core";
import { publicEndpoints, withTenant } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireTenantAccess } from "./guards";
import type { WidgetConfig } from "./public-chat";

const params = z.object({ tenantId: z.string() });
const newKey = () => `pk_${randomBytes(18).toString("base64url")}`;

/** "https://example.com/page" → "https://example.com"; rejects anything that isn't http(s). */
const origin = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
      return url.origin;
    } catch {
      ctx.addIssue({ code: "custom", message: `Not a website address: ${value}` });
      return z.NEVER;
    }
  });

export function registerWidgetSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["website chat"];
  const base = deps.webOrigin ?? "http://localhost:3000";

  async function ensureEndpoint(tenantId: string) {
    return withTenant(deps.db, tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(publicEndpoints)
        .where(and(eq(publicEndpoints.tenantId, tenantId), eq(publicEndpoints.kind, "widget")));
      if (existing) return existing;
      const [created] = await tx
        .insert(publicEndpoints)
        .values({ tenantId, kind: "widget", key: newKey(), enabled: false, config: {} })
        .returning();
      return created!;
    });
  }

  const view = (row: typeof publicEndpoints.$inferSelect) => {
    const config = row.config as WidgetConfig;
    return {
      key: row.key,
      enabled: row.enabled,
      allowedOrigins: config.allowedOrigins ?? [],
      color: config.color ?? "#2563eb",
      title: config.title ?? "",
      position: config.position ?? "right",
      snippet: `<script src="${base}/api/public/widget.js" data-key="${row.key}" data-color="${config.color ?? "#2563eb"}" data-position="${config.position ?? "right"}" async></script>`,
      previewUrl: `${base}/api/public/chat/${row.key}/frame?origin=${encodeURIComponent(base)}`,
    };
  };

  r.get(
    "/api/tenants/:tenantId/widget",
    { schema: { tags, summary: "Website chat settings and embed snippet", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "tenant:read",
      );
      return view(await ensureEndpoint(access.tenantId));
    },
  );

  r.put(
    "/api/tenants/:tenantId/widget",
    {
      schema: {
        tags,
        summary: "Update website chat settings",
        params,
        body: z.object({
          enabled: z.boolean(),
          allowedOrigins: z.array(origin).max(20),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          title: z.string().trim().max(60),
          position: z.enum(["left", "right"]),
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
      const config: WidgetConfig = {
        allowedOrigins: [...new Set(request.body.allowedOrigins)],
        color: request.body.color,
        title: request.body.title || undefined,
        position: request.body.position,
      };
      const [updated] = await withTenant(deps.db, access.tenantId, async (tx) => {
        await recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "widget.settings_updated",
          metadata: { enabled: request.body.enabled, origins: config.allowedOrigins?.length ?? 0 },
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
    "/api/tenants/:tenantId/widget/regenerate",
    {
      schema: {
        tags,
        summary: "New widget key (the old snippet stops working)",
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
      const [updated] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .update(publicEndpoints)
          .set({ key: newKey(), updatedAt: new Date() })
          .where(eq(publicEndpoints.id, row.id))
          .returning(),
      );
      return view(updated!);
    },
  );
}
