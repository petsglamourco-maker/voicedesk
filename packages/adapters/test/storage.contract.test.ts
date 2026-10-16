import { randomUUID } from "node:crypto";
import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { beforeAll, describe, expect, it } from "vitest";
import { InMemoryObjectStorage } from "../src/mocks";
import { S3ObjectStorage } from "../src/storage/s3";
import { tenantKey, type ObjectStorage } from "../src/storage/types";

loadRootEnv();

function s3FromEnv(): S3ObjectStorage {
  return new S3ObjectStorage({
    endpoint: requireEnv("S3_ENDPOINT"),
    region: requireEnv("S3_REGION"),
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    bucket: `${requireEnv("S3_BUCKET")}-test`,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });
}

const implementations: Array<[string, () => Promise<ObjectStorage>]> = [
  ["in-memory", () => Promise.resolve(new InMemoryObjectStorage())],
  [
    "s3 (local SeaweedFS)",
    async () => {
      const s3 = s3FromEnv();
      await s3.ensureBucket();
      return s3;
    },
  ],
];

describe.each(implementations)("ObjectStorage contract: %s", (_name, factory) => {
  let storage: ObjectStorage;
  beforeAll(async () => {
    storage = await factory();
  });

  it("round-trips an object", async () => {
    const key = tenantKey(randomUUID(), "docs", "hello.txt");
    await storage.put({ key, body: "hello world", contentType: "text/plain" });
    const body = await storage.get(key);
    expect(new TextDecoder().decode(body!)).toBe("hello world");
  });

  it("returns null for a missing object", async () => {
    expect(await storage.get(tenantKey(randomUUID(), "missing.txt"))).toBeNull();
  });

  it("deletes a single object", async () => {
    const key = tenantKey(randomUUID(), "a.txt");
    await storage.put({ key, body: "x" });
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });

  it("erases only the given tenant's prefix", async () => {
    const victim = randomUUID();
    const bystander = randomUUID();
    await storage.put({ key: tenantKey(victim, "1.txt"), body: "1" });
    await storage.put({ key: tenantKey(victim, "nested", "2.txt"), body: "2" });
    await storage.put({ key: tenantKey(bystander, "keep.txt"), body: "keep" });

    expect(await storage.deletePrefix(`tenants/${victim}/`)).toBe(2);
    expect(await storage.get(tenantKey(victim, "1.txt"))).toBeNull();
    expect(await storage.get(tenantKey(bystander, "keep.txt"))).not.toBeNull();
  });

  it("produces a signed URL", async () => {
    const key = tenantKey(randomUUID(), "signed.txt");
    await storage.put({ key, body: "s" });
    expect(await storage.signedUrl(key, 60)).toContain(key);
  });
});

describe("tenantKey", () => {
  it("rejects path traversal and unsafe segments", () => {
    expect(() => tenantKey("t1", "..", "x")).toThrow();
    expect(() => tenantKey("t1", "a/b")).toThrow();
    expect(() => tenantKey("../t2")).toThrow();
    expect(tenantKey("t1", "recordings", "call.wav")).toBe("tenants/t1/recordings/call.wav");
  });
});
