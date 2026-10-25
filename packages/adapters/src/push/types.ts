/**
 * Web push notifications (ADR 0024). A subscription is what the browser gives us: the push
 * service's endpoint and the keys to encrypt for it. Messages are encrypted end to end
 * (RFC 8291) and signed with our VAPID key (RFC 8292).
 */
export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushMessage {
  /** Never customer details: names, numbers or message text (OWASP MASVS-PLATFORM). */
  title: string;
  body: string;
  /** An internal page to open, e.g. "/t/<id>/inbox". */
  path: string;
  /** Replaces an earlier notification with the same tag. */
  tag?: string;
  urgent?: boolean;
}

export interface PushProvider {
  readonly name: string;
  /** Public VAPID key the browser needs to subscribe. */
  readonly publicKey: string;
  /** "gone": the subscription has expired or was removed; delete it. */
  send(
    subscription: PushSubscriptionData,
    message: PushMessage,
  ): Promise<"sent" | "gone" | "failed">;
}

/** The push services browsers use; nothing else is ever sent to (no SSRF via endpoints). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      PUSH_HOSTS.some((re) => re.test(url.hostname))
    );
  } catch {
    return false;
  }
}
