/**
 * "Is this a person?" check for public pages (website chat, hosted forms): security audit M3,
 * ADR 0022. `unavailable` means the service couldn't be reached in time; callers let the
 * visitor through then (rate limits and spend caps still apply) and log it.
 */
export interface HumanCheck {
  readonly name: string;
  /** Public key the browser widget needs. */
  readonly siteKey: string;
  verify(token: string, remoteIp?: string): Promise<"human" | "bot" | "unavailable">;
}
