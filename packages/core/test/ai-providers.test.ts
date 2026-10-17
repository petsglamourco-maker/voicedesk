import { randomBytes, randomUUID } from "node:crypto";
import { responseText } from "@voicedesk/adapters";
import { aiProviders, closeDb, withPlatformAccess } from "@voicedesk/db";
import { connectTestDbs, type TestDbs } from "@voicedesk/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeOpenAi, type FakeServer } from "../../adapters/test/fake-openai-server";
import {
  createAppLlm,
  listProviderRows,
  testProvider,
  toView,
  updateProvider,
  type AiProviderRow,
} from "../src/ai-providers";
import { SecretBox } from "../src/secret-box";

const box = new SecretBox(randomBytes(32).toString("base64"));
const secrets = { box };
const actor = randomUUID();
let dbs: TestDbs;
let server: FakeServer;
let original: AiProviderRow[];

const row = async (key: string) => (await listProviderRows(dbs.app)).find((r) => r.key === key)!;

beforeAll(async () => {
  dbs = connectTestDbs();
  server = await startFakeOpenAi();
  original = await listProviderRows(dbs.app);
});

afterAll(async () => {
  // Restore the shared seed rows for other test files.
  await withPlatformAccess(dbs.app, { actorUserId: actor, reason: "test cleanup" }, async (tx) => {
    for (const r of original) {
      await tx
        .update(aiProviders)
        .set({
          enabled: r.enabled,
          baseUrl: r.baseUrl,
          apiKeyEncrypted: r.apiKeyEncrypted,
          priority: r.priority,
          lastTest: r.lastTest,
        })
        .where(eq(aiProviders.id, r.id));
    }
  });
  await server.close();
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

describe("SecretBox", () => {
  it("round-trips and rejects tampering or a different context", () => {
    const sealed = box.encrypt("sk-test-123456789", "ai_providers:deepseek");
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain("sk-test");
    expect(box.decrypt(sealed, "ai_providers:deepseek")).toBe("sk-test-123456789");
    expect(() => box.decrypt(sealed, "ai_providers:local")).toThrow();
    const tampered = `v1:${Buffer.from(Buffer.from(sealed.slice(3), "base64").map((b, i) => (i === 40 ? b ^ 1 : b))).toString("base64")}`;
    expect(() => box.decrypt(tampered, "ai_providers:deepseek")).toThrow();
    expect(() => new SecretBox("short")).toThrow(/32 bytes/);
  });
});

describe("AI provider settings", () => {
  it("stores API keys encrypted and only ever shows a hint", async () => {
    const deepseek = await row("deepseek");
    expect(toView(deepseek, secrets)).toMatchObject({
      ready: false,
      missing: "Add a DeepSeek API key",
    });

    await updateProvider(dbs.app, secrets, actor, deepseek.id, {
      apiKey: "sk-deepseek-abcdef123456",
    });
    const stored = await row("deepseek");
    expect(stored.apiKeyEncrypted).toMatch(/^v1:/);
    expect(stored.apiKeyEncrypted).not.toContain("abcdef");
    expect(toView(stored, secrets)).toMatchObject({ ready: true, apiKeyHint: "sk-…3456" });

    await updateProvider(dbs.app, secrets, actor, deepseek.id, { apiKey: "" });
    expect((await row("deepseek")).apiKeyEncrypted).toBeNull();
  });

  it("refuses to store keys without an encryption key", async () => {
    const deepseek = await row("deepseek");
    await expect(
      updateProvider(dbs.app, { box: null }, actor, deepseek.id, { apiKey: "sk-x" }),
    ).rejects.toThrow(/SETTINGS_ENCRYPTION_KEY/);
  });

  it("routes app LLM calls to the enabled local server and tests the connection", async () => {
    const local = await row("local");
    await updateProvider(dbs.app, secrets, actor, local.id, { baseUrl: server.url, enabled: true });

    server.replies.push(
      { content: "OK" },
      { toolCalls: [{ id: "c1", name: "ping", arguments: '{"message":"hi"}' }] },
    );
    const result = await testProvider(dbs.app, secrets, actor, local.id);
    expect(result).toMatchObject({ ok: true, toolCalls: true, model: "qwen3.6-35b-a3b" });
    expect((await row("local")).lastTest?.ok).toBe(true);

    const llm = createAppLlm(dbs.app, secrets, { ttlMs: 0 });
    // Other seed rows are disabled in the test database, so the local server answers.
    server.replies.push({ content: "Hello from Qwen" });
    const reply = await llm.complete({
      tier: "realtime",
      system: ["test"],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 50,
    });
    expect(responseText(reply)).toBe("Hello from Qwen");

    await updateProvider(dbs.app, secrets, actor, local.id, { enabled: false });
    expect(await llm.available()).toBe((await listProviderRows(dbs.app)).some((r) => r.enabled));
  });
});

describe("connection test context check", () => {
  it("warns when the server reads far fewer prompt tokens than were sent", async () => {
    const local = await row("local");
    await updateProvider(dbs.app, secrets, actor, local.id, { baseUrl: server.url });
    server.replies.push(
      { content: "OK", usage: { prompt_tokens: 1200, completion_tokens: 1 } },
      { toolCalls: [{ id: "c1", name: "ping", arguments: '{"message":"hi"}' }] },
    );
    const result = await testProvider(dbs.app, secrets, actor, local.id);
    expect(result?.ok).toBe(true);
    expect(result?.contextWarning).toMatch(/context window is too small/);
  });
});
