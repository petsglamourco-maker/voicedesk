import webpush from "web-push";
import {
  isPushEndpoint,
  type PushMessage,
  type PushProvider,
  type PushSubscriptionData,
} from "./types";

/** Web Push with VAPID (web-push 3.6.7). Free: browsers' push services carry the messages. */
export class WebPushProvider implements PushProvider {
  readonly name = "web-push";

  constructor(
    private readonly opts: {
      publicKey: string;
      privateKey: string;
      /** mailto: or https: contact for the push services. */
      subject: string;
      timeoutMs?: number;
    },
  ) {}

  get publicKey(): string {
    return this.opts.publicKey;
  }

  async send(
    subscription: PushSubscriptionData,
    message: PushMessage,
  ): Promise<"sent" | "gone" | "failed"> {
    if (!isPushEndpoint(subscription.endpoint)) return "gone";
    try {
      await webpush.sendNotification(subscription, JSON.stringify(message), {
        vapidDetails: {
          subject: this.opts.subject,
          publicKey: this.opts.publicKey,
          privateKey: this.opts.privateKey,
        },
        TTL: message.urgent ? 60 : 3600,
        urgency: message.urgent ? "high" : "normal",
        timeout: this.opts.timeoutMs ?? 10_000,
        ...(message.tag ? { topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
      });
      return "sent";
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? "gone" : "failed";
    }
  }
}

/** New VAPID keys for .env (`pnpm push:keys`). */
export function generatePushKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
