import {
  ImapMailbox,
  MAILBOX_PRESETS,
  type MailboxClient,
  type MailboxCredentials,
} from "@voicedesk/adapters/email/mailbox";
import { sendAssistantEmail, sendStaffEmail } from "@voicedesk/agent-brain";
import {
  deleteMailbox,
  getMailbox,
  mailboxCredentials,
  recordAudit,
  saveMailbox,
  toMailboxView,
  type SecretBox,
} from "@voicedesk/core";
import { channelThreads, withTenant } from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { live } from "../lib/live";
import { requireTenantAccess } from "./guards";
import type { ChannelSender } from "./inbox";

/** Connected support mailbox (Phase 4, ADR 0017): settings, test, and sending replies. */

const params = z.object({ tenantId: z.string() });
const server = z.object({
  host: z
    .string()
    .trim()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9.-]+$/i, "Not a server name"),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
});

const clientFor = (deps: AppDeps) => (creds: MailboxCredentials) =>
  deps.mailboxClient ? deps.mailboxClient(creds) : new ImapMailbox(creds);

function requireBox(deps: AppDeps): SecretBox {
  if (!deps.secrets.box) {
    throw new HttpError(
      409,
      "ENCRYPTION_KEY_MISSING",
      "Set SETTINGS_ENCRYPTION_KEY in .env before connecting a mailbox",
    );
  }
  return deps.secrets.box;
}

/** The business's mailbox client, or a clear error when none is connected. */
async function tenantMailboxClient(deps: AppDeps, tenantId: string): Promise<MailboxClient> {
  const row = await getMailbox(deps.db, tenantId);
  if (!row) throw new HttpError(409, "MAILBOX_NOT_CONNECTED", "Connect a mailbox first");
  return clientFor(deps)(mailboxCredentials(requireBox(deps), row));
}

/** Staff replies on email threads go out from the business's own mailbox, in-thread. */
export function emailSender(deps: AppDeps): ChannelSender {
  return {
    send: async ({ tenantId, threadId, text, authorName }) => {
      await requireEmailThread(deps, tenantId, threadId);
      const client = await tenantMailboxClient(deps, tenantId);
      await sendStaffEmail(deps.db, tenantId, threadId, client, text, authorName);
    },
  };
}

/** The thread must have someone to email (an email thread, or a form with an address). */
async function requireEmailThread(deps: AppDeps, tenantId: string, threadId: string) {
  const [thread] = await withTenant(deps.db, tenantId, (tx) =>
    tx
      .select()
      .from(channelThreads)
      .where(and(eq(channelThreads.id, threadId), eq(channelThreads.tenantId, tenantId))),
  );
  if (!thread) throw notFound();
  if (!canEmailReply(thread)) {
    throw new HttpError(
      409,
      "NO_EMAIL_ADDRESS",
      "This customer didn't leave an email address (or didn't agree to be contacted)",
    );
  }
  return thread;
}

/** Whether replies on this thread can go out by email. */
export function canEmailReply(thread: { channel: string; meta: unknown }): boolean {
  return Boolean((thread.meta as { replyTo?: string } | null)?.replyTo);
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Connection failed";
  return message.slice(0, 300);
}

export function registerMailboxRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["email"];

  r.get(
    "/api/tenants/:tenantId/mailbox",
    { schema: { tags, summary: "The connected support mailbox (no password)", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const row = await getMailbox(deps.db, access.tenantId);
      return {
        mailbox: row ? toMailboxView(row) : null,
        presets: MAILBOX_PRESETS,
        encryptionReady: deps.secrets.box !== null,
      };
    },
  );

  r.put(
    "/api/tenants/:tenantId/mailbox",
    {
      schema: {
        tags,
        summary: "Connect or update the mailbox (logs in first to check the details)",
        params,
        body: z.object({
          emailAddress: z.string().trim().email().max(254),
          username: z.string().trim().min(1).max(254),
          password: z.string().min(1).max(200).optional(),
          imap: server,
          smtp: server,
          folder: z.string().trim().min(1).max(100).default("INBOX"),
          autoSend: z.boolean().default(false),
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
      const box = requireBox(deps);
      const existing = await getMailbox(deps.db, access.tenantId);
      const password =
        request.body.password ?? (existing ? mailboxCredentials(box, existing).password : null);
      if (!password) {
        throw new HttpError(400, "PASSWORD_REQUIRED", "Enter the mailbox's app password");
      }
      try {
        await clientFor(deps)({
          imap: request.body.imap,
          smtp: request.body.smtp,
          username: request.body.username,
          password,
        }).verify();
      } catch (error) {
        throw new HttpError(400, "MAILBOX_LOGIN_FAILED", readableError(error));
      }
      const row = await saveMailbox(deps.db, box, access.tenantId, request.body);
      await withTenant(deps.db, access.tenantId, (tx) =>
        recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: existing ? "mailbox.updated" : "mailbox.connected",
          metadata: { mailboxId: row.id, autoSend: row.autoSend },
        }),
      );
      await deps.jobs.scheduleMailbox(access.tenantId, row.id, true);
      return { mailbox: toMailboxView(row) };
    },
  );

  r.post(
    "/api/tenants/:tenantId/mailbox/test",
    { schema: { tags, summary: "Log in to the saved mailbox", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const client = await tenantMailboxClient(deps, access.tenantId);
      try {
        await client.verify();
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, error: readableError(error) };
      }
    },
  );

  r.delete(
    "/api/tenants/:tenantId/mailbox",
    { schema: { tags, summary: "Disconnect the mailbox (deletes the stored password)", params } },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "agent:configure",
      );
      const row = await deleteMailbox(deps.db, access.tenantId);
      if (!row) throw notFound();
      await deps.jobs.scheduleMailbox(access.tenantId, row.id, false);
      await withTenant(deps.db, access.tenantId, (tx) =>
        recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "mailbox.disconnected",
          metadata: { mailboxId: row.id },
        }),
      );
      return { deleted: true };
    },
  );

  r.post(
    "/api/tenants/:tenantId/inbox/:threadId/send-draft",
    {
      schema: {
        tags,
        summary: "Approve the assistant's email draft (optionally edited) and send it",
        params: params.extend({ threadId: z.string().uuid() }),
        body: z.object({ text: z.string().trim().min(1).max(8000) }),
      },
    },
    async (request) => {
      const access = await requireTenantAccess(
        deps,
        request,
        request.params.tenantId,
        "inbox:reply",
      );
      const thread = await requireEmailThread(deps, access.tenantId, request.params.threadId);
      const client = await tenantMailboxClient(deps, access.tenantId);
      await sendAssistantEmail(deps.db, access.tenantId, thread.id, client, request.body.text);
      await withTenant(deps.db, access.tenantId, (tx) =>
        recordAudit(tx, {
          tenantId: access.tenantId,
          actorType: "user",
          actorUserId: access.session.user.id,
          action: "email.draft_sent",
          metadata: { threadId: thread.id },
        }),
      );
      live.publish({
        tenantId: access.tenantId,
        threadId: thread.id,
        type: "message",
        role: "agent",
        text: request.body.text,
      });
      return { sent: true };
    },
  );
}
