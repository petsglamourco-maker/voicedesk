import { isLlmAvailable } from "@voicedesk/adapters";
import { askBackOffice, scheduleCallbackFor, type ActionKind } from "@voicedesk/agent-brain";
import { can, permissionsFor, recordAudit, type Permission } from "@voicedesk/core";
import { assistantActions, tenants, withTenant } from "@voicedesk/db";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { cancelBookingAsStaff } from "./agent";
import { requireTenantAccess, type TenantAccess } from "./guards";
import { sendStaffReply } from "./inbox";

/**
 * "Ask VoiceDesk" (Phase 6, ADR 0020): questions about the business's own data, and actions
 * the assistant proposes. Approving runs the action through the same code as doing it by
 * hand in the dashboard, with the approver's permissions.
 */

/** What approving each kind of action needs. */
const NEEDS: Record<ActionKind, Permission> = {
  reply: "inbox:reply",
  cancel_booking: "records:write",
  schedule_callback: "records:write",
};

const view = (row: typeof assistantActions.$inferSelect) => ({
  id: row.id,
  kind: row.kind,
  summary: row.summary,
  payload: row.payload,
  status: row.status,
  result: row.result,
  createdAt: row.createdAt,
});

export function registerAssistantRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["assistant"];
  const params = z.object({ tenantId: z.string() });
  const actionParams = params.extend({ id: z.string().uuid() });

  r.post(
    "/api/tenants/:tenantId/assistant/ask",
    {
      schema: {
        tags,
        summary: "Ask about the business (bookings, tickets, calls…); may propose actions",
        params,
        body: z.object({
          question: z.string().trim().min(1).max(2000),
          history: z
            .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
            .max(20)
            .default([]),
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:read",
      );
      if (!(await isLlmAvailable(deps.llm))) {
        throw new HttpError(
          409,
          "AI_OFF",
          "No AI provider is switched on (Platform admin → AI providers)",
        );
      }
      const [tenant] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx.select().from(tenants).where(eq(tenants.id, access.tenantId)),
      );
      const result = await askBackOffice(
        { db: deps.db, llm: deps.llm },
        {
          tenantId: access.tenantId,
          userId: access.session.user.id,
          permissions: permissionsFor(access.role),
          businessName: tenant?.name ?? "",
          timezone: tenant?.timezone ?? "Europe/London",
        },
        request.body.question,
        request.body.history,
      );
      return { answer: result.answer, actions: result.actions.map(view), used: result.used };
    },
  );

  r.get(
    "/api/tenants/:tenantId/assistant/actions",
    { schema: { tags, summary: "Actions waiting for approval (and recent ones)", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:read",
      );
      const rows = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select()
          .from(assistantActions)
          .where(eq(assistantActions.tenantId, access.tenantId))
          .orderBy(desc(assistantActions.createdAt))
          .limit(30),
      );
      return { actions: rows.map(view) };
    },
  );

  /** pending → approving (only once, even with two clicks), or 409. */
  async function claim(access: TenantAccess, id: string, to: "approving" | "rejected") {
    const [row] = await withTenant(deps.db, access.tenantId, (tx) =>
      tx
        .update(assistantActions)
        .set({ status: to, decidedBy: access.session.user.id, decidedAt: new Date() })
        .where(
          and(
            eq(assistantActions.id, id),
            eq(assistantActions.tenantId, access.tenantId),
            eq(assistantActions.status, "pending"),
          ),
        )
        .returning(),
    );
    if (!row) throw new HttpError(409, "NOT_PENDING", "This action was already decided");
    return row;
  }

  r.post(
    "/api/tenants/:tenantId/assistant/actions/:id/approve",
    {
      schema: {
        tags,
        summary: "Approve and carry out a proposed action (a reply may be edited first)",
        params: actionParams,
        body: z.object({ text: z.string().trim().min(1).max(2000).optional() }).default({}),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:read",
      );
      const [pending] = await withTenant(deps.db, access.tenantId, (tx) =>
        tx
          .select()
          .from(assistantActions)
          .where(
            and(
              eq(assistantActions.id, request.params.id),
              eq(assistantActions.tenantId, access.tenantId),
            ),
          ),
      );
      if (!pending) throw notFound();
      const kind = pending.kind as ActionKind;
      if (!can(access.role, NEEDS[kind])) {
        throw new HttpError(403, "FORBIDDEN", "Your role can't approve this action");
      }
      const action = await claim(access, pending.id, "approving");
      const payload = action.payload as Record<string, string | null>;
      let status: "done" | "failed" = "done";
      let result: string;
      try {
        if (kind === "reply") {
          const text = request.body.text ?? payload.text ?? "";
          await sendStaffReply(deps, access, payload.threadId ?? "", text);
          result = "Sent";
        } else if (kind === "cancel_booking") {
          await cancelBookingAsStaff(deps, access, payload.bookingId ?? "", request.log);
          result = "Booking cancelled; the customer has been told";
        } else {
          const row = await scheduleCallbackFor(
            deps.db,
            access.tenantId,
            {
              type: payload.sourceType === "ticket" ? "ticket" : "message",
              id: payload.sourceId ?? "",
            },
            { force: true, createdBy: access.session.user.id },
          );
          if (!row) throw new HttpError(409, "CANNOT_SCHEDULE", "A call is already planned");
          result = "Call planned (within calling hours)";
        }
      } catch (error) {
        status = "failed";
        result = error instanceof Error ? error.message : "Failed";
      }
      await withTenant(deps.db, access.tenantId, async (tx) => {
        await tx
          .update(assistantActions)
          .set({ status, result: result.slice(0, 300) })
          .where(eq(assistantActions.id, action.id));
        await recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: `assistant.action_${status === "done" ? "approved" : "failed"}`,
          targetType: "assistant_action",
          targetId: action.id,
          metadata: { kind },
        });
      });
      return { status, result };
    },
  );

  r.post(
    "/api/tenants/:tenantId/assistant/actions/:id/reject",
    { schema: { tags, summary: "Reject a proposed action", params: actionParams } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "records:read",
      );
      const row = await claim(access, request.params.id, "rejected");
      return { status: row.status };
    },
  );
}
