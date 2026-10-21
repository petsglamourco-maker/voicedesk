import nodemailer, { type Transporter } from "nodemailer";
import { ProviderError } from "../errors";
import type { EmailMessage, EmailProvider } from "./types";

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  defaultFrom: string;
  /** Use implicit TLS (port 465). STARTTLS is negotiated automatically otherwise. */
  secure?: boolean;
}

/** SMTP email. Locally this targets Mailpit; in production any SMTP relay (Postmark, Resend...). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // Port 465 is TLS from the first byte; 587/25 upgrade with STARTTLS.
      secure: config.secure ?? config.port === 465,
      ...(config.user ? { auth: { user: config.user, pass: config.password ?? "" } } : {}),
    });
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    try {
      const info = await this.transport.sendMail({
        from: message.from ?? this.config.defaultFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
        headers: message.tags
          ? Object.fromEntries(Object.entries(message.tags).map(([k, v]) => [`X-Tag-${k}`, v]))
          : undefined,
      });
      return { id: info.messageId };
    } catch (cause) {
      throw new ProviderError(this.name, "failed to send email", { retryable: true, cause });
    }
  }
}

/**
 * Domains that can never receive real mail (RFC 2606 / RFC 6761): example.com/.net/.org and
 * the .test, .example, .invalid, .localhost and .local suffixes. Tests and demo data use them.
 */
export function isReservedAddress(address: string): boolean {
  const domain = address.trim().replace(/>$/, "").split("@").pop()?.toLowerCase() ?? "";
  return (
    /^(example\.(com|net|org)|localhost)$/.test(domain) ||
    /\.(test|example|invalid|localhost|local)$/.test(domain) ||
    /(^|\.)example\.(com|net|org)$/.test(domain)
  );
}

/**
 * Sends real mail through `real`, but delivers reserved-domain recipients (tests, demo data,
 * stand-in texts) to `local` (Mailpit) — they could only bounce, hurting the sender's reputation.
 */
export class ReservedDomainRouter implements EmailProvider {
  readonly name = "smtp-routed";

  constructor(
    private readonly real: EmailProvider,
    private readonly local: EmailProvider,
  ) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    const reserved = to.filter(isReservedAddress);
    const deliverable = to.filter((a) => !isReservedAddress(a));
    let result: { id: string } | undefined;
    if (reserved.length) result = await this.local.send({ ...message, to: reserved });
    if (deliverable.length) result = await this.real.send({ ...message, to: deliverable });
    return result ?? { id: "" };
  }
}
