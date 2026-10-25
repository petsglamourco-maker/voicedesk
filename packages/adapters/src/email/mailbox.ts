import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import { ProviderError } from "../errors";
import { resolvePublicHost } from "../net/public-address";

/**
 * A business's own support mailbox (Phase 4, ADR 0017): read new mail over IMAP and reply
 * over SMTP with an app password. Works with Gmail, Zoho and most hosts.
 */

export interface MailServer {
  host: string;
  port: number;
  /** TLS from the start (993 / 465); false = STARTTLS (143 / 587). */
  secure: boolean;
}

export interface MailboxCredentials {
  imap: MailServer;
  smtp: MailServer;
  username: string;
  password: string;
}

export interface InboundEmail {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: { address: string; name: string | null };
  subject: string;
  /** Plain text with quoted earlier messages removed. */
  text: string;
  date: Date;
  /** Newsletters, auto-replies, bounces: never answered. */
  automated: boolean;
  /**
   * The receiving mail server verified the sender (DMARC pass, or DKIM pass for the sender's
   * own domain). Only these may get an automatic reply (security audit M14).
   */
  authenticated: boolean;
  attachmentNames: string[];
}

export interface FetchResult {
  uidValidity: number;
  /** Highest UID seen (store it; the next poll fetches newer ones). */
  lastUid: number;
  messages: InboundEmail[];
}

export interface MailboxClient {
  /** Logs in to IMAP and SMTP; throws ProviderError with a readable reason. */
  verify(): Promise<void>;
  /** New messages after `lastUid` (all reset if the folder's UIDVALIDITY changed). */
  fetchNew(folder: string, lastUid: number, uidValidity: number | null): Promise<FetchResult>;
  send(message: OutgoingEmail): Promise<{ messageId: string }>;
}

export interface OutgoingEmail {
  fromName: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string[];
}

const PROVIDER = "mailbox";
const NO_REPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i;

/** Drops quoted history ("On … wrote:", "> …", Outlook's "From: … Sent:" block). */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^On .+wrote:\s*$/.test(line) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^From: .+/.test(line) && /^(Sent|Date): .+/.test(lines[i + 1] ?? "")) break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstAddress(addr: AddressObject | AddressObject[] | undefined) {
  const list = Array.isArray(addr) ? addr : addr ? [addr] : [];
  const first = list.flatMap((a) => a.value)[0];
  return first?.address ? { address: first.address.toLowerCase(), name: first.name || null } : null;
}

export class ImapMailbox implements MailboxClient {
  constructor(private readonly creds: MailboxCredentials) {}

  // Hosts are business-supplied: connect only to a public address (SSRF, security audit H2),
  // pinned to the IP that was checked, with the name kept for TLS. Never send the password
  // unencrypted: STARTTLS is required when the port isn't TLS from the start.
  private async imap() {
    const { address } = await resolvePublicHost(this.creds.imap.host);
    return new ImapFlow({
      host: address,
      servername: this.creds.imap.host,
      port: this.creds.imap.port,
      secure: this.creds.imap.secure,
      doSTARTTLS: this.creds.imap.secure ? undefined : true,
      auth: { user: this.creds.username, pass: this.creds.password },
      logger: false,
      socketTimeout: 30_000,
    });
  }

  private async smtp() {
    const { address } = await resolvePublicHost(this.creds.smtp.host);
    return nodemailer.createTransport({
      host: address,
      port: this.creds.smtp.port,
      secure: this.creds.smtp.secure,
      requireTLS: !this.creds.smtp.secure,
      tls: { servername: this.creds.smtp.host },
      auth: { user: this.creds.username, pass: this.creds.password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  async verify(): Promise<void> {
    try {
      const client = await this.imap();
      await client.connect();
      await client.logout();
    } catch (error) {
      throw new ProviderError(PROVIDER, `IMAP login failed: ${(error as Error).message}`, {
        cause: error,
        retryable: false,
      });
    }
    try {
      await (await this.smtp()).verify();
    } catch (error) {
      throw new ProviderError(PROVIDER, `SMTP login failed: ${(error as Error).message}`, {
        cause: error,
        retryable: false,
      });
    }
  }

  async fetchNew(
    folder: string,
    lastUid: number,
    uidValidity: number | null,
  ): Promise<FetchResult> {
    const client = await this.imap();
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const mailbox = client.mailbox;
      const currentValidity = mailbox ? Number(mailbox.uidValidity) : 0;
      // A changed UIDVALIDITY means old UIDs are meaningless: start from what arrives next.
      if (uidValidity !== null && currentValidity !== uidValidity) {
        const next = mailbox ? Number(mailbox.uidNext) - 1 : 0;
        return { uidValidity: currentValidity, lastUid: next, messages: [] };
      }
      // First connection: don't answer the whole backlog, only mail from now on.
      if (uidValidity === null) {
        const next = mailbox ? Number(mailbox.uidNext) - 1 : 0;
        return { uidValidity: currentValidity, lastUid: next, messages: [] };
      }
      const messages: InboundEmail[] = [];
      let highest = lastUid;
      for await (const msg of client.fetch(
        `${lastUid + 1}:*`,
        { uid: true, source: true },
        { uid: true },
      )) {
        if (msg.uid <= lastUid) continue; // "n:*" returns the last message even when none are newer
        highest = Math.max(highest, msg.uid);
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const from = firstAddress(parsed.from);
        if (!from) continue;
        const header = (name: string) => {
          const value = parsed.headers.get(name);
          return typeof value === "string"
            ? value.toLowerCase()
            : value
              ? JSON.stringify(value)
              : "";
        };
        const automated =
          (header("auto-submitted") !== "" && header("auto-submitted") !== "no") ||
          /bulk|list|junk/.test(header("precedence")) ||
          parsed.headers.has("list-id") ||
          parsed.headers.has("list-unsubscribe") ||
          NO_REPLY.test(from.address);
        messages.push({
          uid: msg.uid,
          messageId: parsed.messageId ?? null,
          inReplyTo: parsed.inReplyTo ?? null,
          references: Array.isArray(parsed.references)
            ? parsed.references
            : parsed.references
              ? [parsed.references]
              : [],
          from,
          subject: parsed.subject ?? "",
          text: stripQuoted(parsed.text ?? "").slice(0, 8000),
          date: parsed.date ?? new Date(),
          automated,
          authenticated: senderAuthenticated(
            parsed.headerLines.filter((h) => h.key === "authentication-results").map((h) => h.line),
            from.address,
          ),
          attachmentNames: parsed.attachments.map((a) => a.filename ?? "attachment"),
        });
      }
      return { uidValidity: currentValidity, lastUid: highest, messages };
    } finally {
      lock.release();
      await client.logout().catch(() => undefined);
    }
  }

  async send(message: OutgoingEmail): Promise<{ messageId: string }> {
    const info = await (
      await this.smtp()
    ).sendMail({
      from: { name: message.fromName, address: this.creds.username },
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(message.references?.length ? { references: message.references } : {}),
    });
    return { messageId: String(info.messageId) };
  }
}

/** Common providers, so businesses only enter their address and app password. */
export const MAILBOX_PRESETS: Record<string, { imap: MailServer; smtp: MailServer }> = {
  gmail: {
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  },
  zoho: {
    imap: { host: "imap.zoho.eu", port: 993, secure: true },
    smtp: { host: "smtp.zoho.eu", port: 465, secure: true },
  },
  icloud: {
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
  },
  yahoo: {
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
  },
};

/**
 * Reads the receiving server's verdict (the topmost Authentication-Results header, which the
 * server adds itself). DMARC pass, or DKIM pass signed by the From domain (or its parent).
 */
export function senderAuthenticated(headers: string[], fromAddress: string): boolean {
  const top = (headers[0] ?? "").toLowerCase();
  if (!top) return false;
  if (/\bdmarc=pass\b/.test(top)) return true;
  const fromDomain = fromAddress.toLowerCase().split("@")[1] ?? "";
  for (const m of top.matchAll(/\bdkim=pass\b[^;]*?header\.(?:d|i)=@?([a-z0-9.-]+)/g)) {
    const signer = m[1]!;
    if (fromDomain === signer || fromDomain.endsWith(`.${signer}`)) return true;
  }
  return false;
}
