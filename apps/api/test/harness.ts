import { randomBytes, randomUUID } from "node:crypto";
import {
  InMemoryObjectStorage,
  MockEmbeddingProvider,
  MockLlmProvider,
  type LlmProvider,
} from "@voicedesk/adapters";
import type { AuthEmail } from "@voicedesk/auth";
import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { SecretBox, type ProviderSecrets } from "@voicedesk/core";
import { closeDb, createDb, type Database } from "@voicedesk/db";
import type { AiJob, ProcessSourceJob } from "@voicedesk/jobs";
import { processSource } from "@voicedesk/knowledge";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { buildApp, type AppDeps } from "../src/app";
import { createAppAuth, type JobDispatcher } from "../src/container";
import { parseEnv } from "../src/env";

export const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery";

export interface TestHarness {
  app: FastifyInstance;
  secrets: ProviderSecrets;
  db: Database;
  outbox: AuthEmail[];
  jobs: { sources: ProcessSourceJob[]; ai: AiJob[]; recrawls: Array<[string, number | null]> };
  llm: MockLlmProvider;
  storage: InMemoryObjectStorage;
  close: () => Promise<void>;
}

/**
 * Builds the API against the test database with in-memory/mock providers. Knowledge jobs
 * run inline, so tests can assert on processed results without a worker.
 */
export async function createHarness(
  options: Pick<AppDeps, "voice" | "tts" | "sip"> & { llm?: LlmProvider } = {},
): Promise<TestHarness> {
  loadRootEnv();
  const env = parseEnv({
    ...process.env,
    DATABASE_URL: requireEnv("TEST_DATABASE_URL"),
    LOG_LEVEL: "silent",
  });
  const db = createDb(env.DATABASE_URL);
  const outbox: AuthEmail[] = [];
  const auth = createAppAuth(env, db, (email) => {
    outbox.push(email);
    return Promise.resolve();
  });
  const storage = new InMemoryObjectStorage();
  const embeddings = new MockEmbeddingProvider();
  const llm = new MockLlmProvider();
  const recorded: TestHarness["jobs"] = { sources: [], ai: [], recrawls: [] };
  const jobs: JobDispatcher = {
    processSource: async (job) => {
      recorded.sources.push(job);
      await processSource({ db, embeddings, storage }, job.tenantId, job.sourceId);
    },
    scheduleRecrawl: (job, days) => {
      recorded.recrawls.push([job.sourceId, days ?? null]);
      return Promise.resolve();
    },
    enqueueAi: (job) => {
      recorded.ai.push(job);
      return Promise.resolve();
    },
  };
  const secrets: ProviderSecrets = { box: new SecretBox(randomBytes(32).toString("base64")) };
  const app = await buildApp({
    db,
    secrets,
    auth,
    storage,
    jobs,
    embeddings: () => Promise.resolve(embeddings),
    llm: options.llm ?? llm,
    voice: options.voice ?? null,
    tts: options.tts ?? null,
    sip: options.sip ?? null,
    checkRedis: () => Promise.resolve(true),
    logLevel: "silent",
  });
  return {
    app,
    secrets,
    db,
    outbox,
    jobs: recorded,
    llm,
    storage,
    close: async () => {
      await app.close();
      await closeDb(db);
    },
  };
}

export function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

export function lastEmailTo(h: TestHarness, email: string): AuthEmail {
  const found = h.outbox.findLast((m) => m.to === email);
  if (!found) throw new Error(`no email sent to ${email}`);
  return found;
}

/** Signs up, follows the emailed verification link, and returns the session cookie. */
export async function signUpVerified(
  h: TestHarness,
  name: string,
): Promise<{ email: string; cookie: string }> {
  const email = `${name.toLowerCase()}-${randomUUID()}@example.com`;
  const signUp = await h.app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { name, email, password: PASSWORD },
  });
  expect(signUp.statusCode).toBe(200);
  expect(cookieFrom(signUp)).not.toContain("session_token");

  const link = new URL(/https?:\/\/\S+/.exec(lastEmailTo(h, email).text)![0]);
  const verify = await h.app.inject({
    method: "GET",
    url: link.pathname + link.search,
    headers: { origin: ORIGIN },
  });
  expect(verify.statusCode).toBeLessThan(400);
  const cookie = cookieFrom(verify);
  expect(cookie).toContain("session_token");
  return { email, cookie };
}

/** Signs up a new owner and creates a business. */
export async function createOwnerWithTenant(h: TestHarness, businessName = "Bright Dental") {
  const owner = await signUpVerified(h, "Owner");
  const res = await h.app.inject({
    method: "POST",
    url: "/api/tenants",
    headers: { cookie: owner.cookie, origin: ORIGIN },
    payload: {
      name: businessName,
      countryCode: "GB",
      timezone: "Europe/London",
      defaultLanguage: "en",
    },
  });
  expect(res.statusCode).toBe(201);
  return { ...owner, tenantId: res.json<{ id: string }>().id };
}
