import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets stored in the database (e.g. provider API keys).
 * The key comes from SETTINGS_ENCRYPTION_KEY (32 random bytes, base64). Output format:
 * "v1:" + base64(iv[12] | authTag[16] | ciphertext). `context` is bound as associated
 * data, so a ciphertext copied to another row fails to decrypt.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32)
      throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    this.key = key;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox | null {
    return env.SETTINGS_ENCRYPTION_KEY ? new SecretBox(env.SETTINGS_ENCRYPTION_KEY) : null;
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
  }

  decrypt(payload: string, context: string): string {
    if (!payload.startsWith("v1:")) throw new Error("Unknown secret format");
    const raw = Buffer.from(payload.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}

/** "sk-…abcd" style hint for showing a stored secret without revealing it. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "••••";
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}
