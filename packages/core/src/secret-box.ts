import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets stored in the database (provider API keys, calendar
 * tokens, mailbox passwords), with a key ring (security audit M12):
 * - new values: "v2:<keyId>:" + base64(iv[12] | authTag[16] | ciphertext), sealed with the
 *   current key (SETTINGS_ENCRYPTION_KEY, id SETTINGS_ENCRYPTION_KEY_ID, default "k1");
 * - older keys stay usable for reading via SETTINGS_ENCRYPTION_OLD_KEYS ("id:base64,…"), so a
 *   key can be rotated and everything re-encrypted (`pnpm --filter @voicedesk/core reencrypt`);
 * - "v1:" values (before key ids) are read with the current key, then the old keys.
 * `context` is bound as associated data, so a ciphertext copied to another row fails.
 */
const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/;

function parseKey(base64Key: string, what: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error(`${what} must be 32 bytes, base64-encoded`);
  return key;
}

export class SecretBox {
  private readonly current: { id: string; key: Buffer };
  private readonly keys = new Map<string, Buffer>();

  constructor(
    base64Key: string,
    options: { keyId?: string; oldKeys?: Record<string, string> } = {},
  ) {
    const id = options.keyId ?? "k1";
    if (!KEY_ID.test(id))
      throw new Error("SETTINGS_ENCRYPTION_KEY_ID must be 1-16 letters or digits");
    this.current = { id, key: parseKey(base64Key, "SETTINGS_ENCRYPTION_KEY") };
    for (const [oldId, oldKey] of Object.entries(options.oldKeys ?? {})) {
      if (!KEY_ID.test(oldId))
        throw new Error(`Bad key id "${oldId}" in SETTINGS_ENCRYPTION_OLD_KEYS`);
      this.keys.set(oldId, parseKey(oldKey, `Old key "${oldId}"`));
    }
    this.keys.set(id, this.current.key);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox | null {
    if (!env.SETTINGS_ENCRYPTION_KEY) return null;
    const oldKeys = Object.fromEntries(
      (env.SETTINGS_ENCRYPTION_OLD_KEYS ?? "")
        .split(",")
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
          const at = pair.indexOf(":");
          if (at < 1)
            throw new Error("SETTINGS_ENCRYPTION_OLD_KEYS entries look like id:base64key");
          return [pair.slice(0, at), pair.slice(at + 1)];
        }),
    );
    return new SecretBox(env.SETTINGS_ENCRYPTION_KEY, {
      keyId: env.SETTINGS_ENCRYPTION_KEY_ID || undefined,
      oldKeys,
    });
  }

  get currentKeyId(): string {
    return this.current.id;
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.current.key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const body = Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
    return `v2:${this.current.id}:${body}`;
  }

  decrypt(payload: string, context: string): string {
    if (payload.startsWith("v2:")) {
      const at = payload.indexOf(":", 3);
      const id = payload.slice(3, at);
      const key = this.keys.get(id);
      if (at < 0 || !key)
        throw new Error(`Secret was sealed with key "${id}", which isn't configured`);
      return open(key, payload.slice(at + 1), context);
    }
    if (payload.startsWith("v1:")) {
      // Before key ids: the current key, then any old ones.
      let last: unknown;
      for (const key of [this.current.key, ...this.keys.values()]) {
        try {
          return open(key, payload.slice(3), context);
        } catch (error) {
          last = error;
        }
      }
      throw last instanceof Error ? last : new Error("Secret can't be decrypted");
    }
    throw new Error("Unknown secret format");
  }

  /** True when a value should be re-encrypted with the current key. */
  needsRotation(payload: string): boolean {
    return !payload.startsWith(`v2:${this.current.id}:`);
  }
}

function open(key: Buffer, base64: string, context: string): string {
  const raw = Buffer.from(base64, "base64");
  // A fixed 16-byte tag: a shortened (forgeable) tag is refused.
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12), {
    authTagLength: 16,
  });
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** "sk-…abcd" style hint for showing a stored secret without revealing it. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "••••";
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}
