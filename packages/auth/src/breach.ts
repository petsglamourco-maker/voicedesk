import { createHash } from "node:crypto";

/**
 * Have I Been Pwned "range" check (k-anonymity): only the first 5 hex characters of the
 * password's SHA-1 leave the server. Returns how many breaches contain the password, or
 * null when the service can't be reached in time. Callers let the password through then
 * (a slow or unreachable service must never stop people signing up), and log it.
 */
export async function breachCount(
  password: string,
  options: { timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<number | null> {
  // nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_sha1 -- reviewed: Have I Been Pwned's range API is defined on SHA-1; not used for integrity
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await (options.fetch ?? fetch)(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "VoiceDesk password check" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
    });
    if (!res.ok) return null;
    for (const line of (await res.text()).split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}

/** The auth endpoints that set a password, and the body field that carries it. */
export const PASSWORD_FIELDS: Record<string, "password" | "newPassword"> = {
  "/sign-up/email": "password",
  "/change-password": "newPassword",
  "/reset-password": "newPassword",
};
