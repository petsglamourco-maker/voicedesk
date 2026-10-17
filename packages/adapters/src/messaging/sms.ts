import { ProviderError } from "../errors";
import type { EmailProvider } from "../email/types";
import type { SmsMessage, SmsProvider } from "./types";

/**
 * Development SMS: each text is delivered as an email so it can be read in Mailpit
 * (`sms+447700900123@sms.local`). Nothing is sent to a phone and nothing costs money.
 */
export class MailpitSmsProvider implements SmsProvider {
  readonly name = "mailpit-sms";

  constructor(private readonly email: EmailProvider) {}

  async send(message: SmsMessage): Promise<{ id: string }> {
    const digits = message.to.replace(/\D/g, "");
    return this.email.send({
      to: `sms+${digits}@sms.local`,
      from: `sms-from-${message.from.replace(/[^A-Za-z0-9]/g, "") || "voicedesk"}@sms.local`,
      subject: `SMS to ${message.to} (${message.body.length} chars)`,
      text: message.body,
      tags: { kind: "sms" },
    });
  }
}

/** Twilio Programmable Messaging over REST. Off unless SMS_PROVIDER=twilio (costs money). */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio-sms";
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      accountSid: string;
      authToken: string;
      baseUrl?: string;
      fetch?: typeof fetch;
    },
  ) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async send(message: SmsMessage): Promise<{ id: string }> {
    const base = this.options.baseUrl ?? "https://api.twilio.com";
    const auth = Buffer.from(`${this.options.accountSid}:${this.options.authToken}`).toString(
      "base64",
    );
    const res = await this.fetchImpl(
      `${base}/2010-04-01/Accounts/${encodeURIComponent(this.options.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: message.to,
          From: message.from,
          Body: message.body,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new ProviderError(this.name, `HTTP ${res.status}: ${detail}`, {
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    const body = (await res.json()) as { sid: string };
    return { id: body.sid };
  }
}
