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
