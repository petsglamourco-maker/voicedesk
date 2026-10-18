import type { MailboxCredentials, MailServer } from "@voicedesk/adapters/email/mailbox";
import { mailboxes, withTenant, type Database } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import type { SecretBox } from "./secret-box";

/** Connected support mailboxes (Phase 4, ADR 0017). The app password is stored encrypted. */

export type MailboxRow = typeof mailboxes.$inferSelect;

const context = (tenantId: string) => `mailboxes:${tenantId}`;

export interface MailboxView {
  id: string;
  emailAddress: string;
  username: string;
  imap: MailServer;
  smtp: MailServer;
  folder: string;
  autoSend: boolean;
  status: string;
  lastError: string | null;
  lastPolledAt: Date | null;
}

export function toMailboxView(row: MailboxRow): MailboxView {
  return {
    id: row.id,
    emailAddress: row.emailAddress,
    username: row.username,
    imap: { host: row.imapHost, port: row.imapPort, secure: row.imapSecure },
    smtp: { host: row.smtpHost, port: row.smtpPort, secure: row.smtpSecure },
    folder: row.folder,
    autoSend: row.autoSend,
    status: row.status,
    lastError: row.lastError,
    lastPolledAt: row.lastPolledAt,
  };
}

export async function getMailbox(db: Database, tenantId: string): Promise<MailboxRow | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(mailboxes).where(eq(mailboxes.tenantId, tenantId)),
  );
  return row ?? null;
}

export function mailboxCredentials(box: SecretBox, row: MailboxRow): MailboxCredentials {
  return {
    imap: { host: row.imapHost, port: row.imapPort, secure: row.imapSecure },
    smtp: { host: row.smtpHost, port: row.smtpPort, secure: row.smtpSecure },
    username: row.username,
    password: box.decrypt(row.passwordEncrypted, context(row.tenantId)),
  };
}

export interface MailboxInput {
  emailAddress: string;
  username: string;
  /** Required when connecting; omit to keep the stored one. */
  password?: string;
  imap: MailServer;
  smtp: MailServer;
  folder: string;
  autoSend: boolean;
}

/** Connects or updates the business's mailbox. Changing the server resets the read position. */
export async function saveMailbox(
  db: Database,
  box: SecretBox,
  tenantId: string,
  input: MailboxInput,
): Promise<MailboxRow> {
  const existing = await getMailbox(db, tenantId);
  if (!existing && !input.password) throw new Error("A password is needed to connect a mailbox");
  const serverChanged =
    !existing ||
    existing.imapHost !== input.imap.host ||
    existing.username !== input.username ||
    existing.folder !== input.folder;
  const values = {
    emailAddress: input.emailAddress.toLowerCase(),
    username: input.username,
    imapHost: input.imap.host,
    imapPort: input.imap.port,
    imapSecure: input.imap.secure,
    smtpHost: input.smtp.host,
    smtpPort: input.smtp.port,
    smtpSecure: input.smtp.secure,
    folder: input.folder,
    autoSend: input.autoSend,
    status: "active",
    lastError: null,
    ...(input.password ? { passwordEncrypted: box.encrypt(input.password, context(tenantId)) } : {}),
    ...(serverChanged ? { uidValidity: null, lastUid: 0 } : {}),
    updatedAt: new Date(),
  };
  const [row] = await withTenant(db, tenantId, (tx) =>
    existing
      ? tx.update(mailboxes).set(values).where(eq(mailboxes.id, existing.id)).returning()
      : tx
          .insert(mailboxes)
          .values({ ...values, tenantId, passwordEncrypted: values.passwordEncrypted! })
          .returning(),
  );
  return row!;
}

export async function deleteMailbox(db: Database, tenantId: string): Promise<MailboxRow | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx.delete(mailboxes).where(eq(mailboxes.tenantId, tenantId)).returning(),
  );
  return row ?? null;
}

/** Saves where the poller got to, or the error it hit (shown on the settings page). */
export async function recordMailboxPoll(
  db: Database,
  row: MailboxRow,
  result: { uidValidity: number; lastUid: number } | { error: string },
): Promise<void> {
  await withTenant(db, row.tenantId, (tx) =>
    tx
      .update(mailboxes)
      .set(
        "error" in result
          ? { status: "error", lastError: result.error.slice(0, 300), lastPolledAt: new Date() }
          : {
              status: "active",
              lastError: null,
              uidValidity: result.uidValidity,
              lastUid: result.lastUid,
              lastPolledAt: new Date(),
            },
      )
      .where(eq(mailboxes.id, row.id)),
  );
}
