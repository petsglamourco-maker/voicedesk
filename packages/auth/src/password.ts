import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyPassword as verifyScrypt } from "better-auth/crypto";

/**
 * Password hashing (security audit M16): Argon2id with the OWASP minimum settings
 * (19 MiB, 2 passes, 1 lane), using Node's built-in implementation, stored as a PHC string:
 * `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`. Older accounts still have Better Auth's
 * scrypt hashes (`salt:key`); they verify as before and are upgraded on the next sign-in.
 */
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const PREFIX = "$argon2id$";

function derive(
  password: string,
  salt: Buffer,
  p: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2("argon2id", { message: password, nonce: salt, ...p }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

const b64 = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  const { memory, passes, parallelism } = PARAMS;
  return `${PREFIX}v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(key)}`;
}

export function isCurrentHash(hash: string): boolean {
  return hash.startsWith(PREFIX);
}

export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  const { hash, password } = data;
  if (!isCurrentHash(hash)) return verifyScrypt({ hash, password });
  const [, , , params, saltB64, keyB64] = hash.split("$");
  const m = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(params ?? "");
  if (!m || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await derive(password, Buffer.from(saltB64, "base64"), {
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
