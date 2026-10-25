import { randomUUID } from "node:crypto";
import type { HumanCheck } from "./types";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Cloudflare Turnstile (free). Server-side validation per Cloudflare's docs: POST secret +
 * response (+ remoteip, idempotency_key) to siteverify; tokens last 5 minutes and work once.
 */
export class TurnstileHumanCheck implements HumanCheck {
  readonly name = "turnstile";

  constructor(
    private readonly opts: {
      siteKey: string;
      secretKey: string;
      timeoutMs?: number;
      fetch?: typeof fetch;
    },
  ) {}

  get siteKey(): string {
    return this.opts.siteKey;
  }

  async verify(token: string, remoteIp?: string): Promise<"human" | "bot" | "unavailable"> {
    if (!token || token.length > 2048) return "bot";
    try {
      const res = await (this.opts.fetch ?? fetch)(SITEVERIFY, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: this.opts.secretKey,
          response: token,
          ...(remoteIp ? { remoteip: remoteIp } : {}),
          idempotency_key: randomUUID(),
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
      });
      if (!res.ok) return "unavailable";
      const body = (await res.json()) as { success?: boolean };
      return body.success === true ? "human" : "bot";
    } catch {
      return "unavailable";
    }
  }
}
