import { ProviderError } from "../errors";
import type { WhatsAppProvider, WhatsAppTemplateMessage, WhatsAppTextMessage } from "./types";

/**
 * WhatsApp Business Cloud API (Meta Graph API, plain HTTPS). Phase 4, ADR 0017.
 * `senderId` is the business's WhatsApp phone-number id.
 */

const PROVIDER = "whatsapp-cloud";
export const DEFAULT_GRAPH_VERSION = "v25.0";

export class WhatsAppCloudProvider implements WhatsAppProvider {
  readonly name = PROVIDER;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(
    private readonly options: {
      accessToken: string;
      graphVersion?: string;
      baseUrl?: string;
      fetch?: typeof fetch;
    },
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.base = `${options.baseUrl ?? "https://graph.facebook.com"}/${options.graphVersion ?? DEFAULT_GRAPH_VERSION}`;
  }

  private async post(phoneNumberId: string, body: Record<string, unknown>): Promise<Response> {
    const res = await this.fetchImpl(`${this.base}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new ProviderError(PROVIDER, `HTTP ${res.status}: ${detail}`, {
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    return res;
  }

  async sendText(senderId: string, message: WhatsAppTextMessage): Promise<{ id: string }> {
    const res = await this.post(senderId, {
      recipient_type: "individual",
      to: message.to,
      type: "text",
      text: { preview_url: false, body: message.text.slice(0, 4096) },
    });
    const body = (await res.json()) as { messages?: Array<{ id: string }> };
    return { id: body.messages?.[0]?.id ?? "" };
  }

  async sendTemplate(senderId: string, message: WhatsAppTemplateMessage): Promise<{ id: string }> {
    const res = await this.post(senderId, {
      to: message.to,
      type: "template",
      template: {
        name: message.templateName,
        language: { code: message.languageCode },
        components: message.parameters.length
          ? [
              {
                type: "body",
                parameters: message.parameters.map((text) => ({ type: "text", text })),
              },
            ]
          : [],
      },
    });
    const body = (await res.json()) as { messages?: Array<{ id: string }> };
    return { id: body.messages?.[0]?.id ?? "" };
  }

  /** Blue ticks: tells the customer their message was read. Best effort. */
  async markRead(phoneNumberId: string, messageId: string): Promise<void> {
    await this.post(phoneNumberId, { status: "read", message_id: messageId }).catch(
      () => undefined,
    );
  }
}

export interface WhatsAppInbound {
  /** Business number that received it (routes to the business). */
  phoneNumberId: string;
  /** Customer's number in E.164. */
  from: string;
  profileName: string | null;
  messageId: string;
  timestamp: Date;
  /** Text, or a short description for media we don't read ("[image]"). */
  text: string;
}

interface WebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
        }>;
      };
    }>;
  }>;
}

/** Customer messages in a webhook delivery (status updates and other events are ignored). */
export function parseWhatsAppWebhook(payload: unknown): WhatsAppInbound[] {
  const body = payload as WebhookBody;
  if (body?.object !== "whatsapp_business_account") return [];
  const out: WhatsAppInbound[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const m of value.messages ?? []) {
        if (!m.from || !m.id) continue;
        const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        const text =
          m.type === "text"
            ? (m.text?.body ?? "")
            : m.type === "button"
              ? (m.button?.text ?? "")
              : m.type === "interactive"
                ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "")
                : `[${m.type ?? "message"}]`;
        if (!text.trim()) continue;
        out.push({
          phoneNumberId,
          from: m.from.startsWith("+") ? m.from : `+${m.from}`,
          profileName: name,
          messageId: m.id,
          timestamp: new Date(Number(m.timestamp ?? 0) * 1000),
          text: text.slice(0, 4000),
        });
      }
    }
  }
  return out;
}
