export interface EmailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** Overrides the default sender, e.g. a tenant's verified sender domain. */
  from?: string;
  replyTo?: string;
  /** Provider-side tags for analytics/routing, e.g. { tenantId, kind: "summary" }. */
  tags?: Record<string, string>;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}
