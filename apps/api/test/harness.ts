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
import { closeDb, createDb, user, type Database } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import type { AiJob, ChannelJob, NotificationJob, ProcessSourceJob } from "@voicedesk/jobs";
import { processSource } from "@voicedesk/knowledge";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { buildApp, type AppDeps } from "../src/app";
import {
  createAppAuth,
  disconnectRemovedMembersCalendar,
  type JobDispatcher,
} from "../src/container";
import { freshAuthStore } from "../src/lib/fresh-auth";
import { memoryKv, type Kv } from "../src/lib/kv";
import { oauthStateSecretFor, parseEnv } from "../src/env";

export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "correct-horse-battery";

export interface TestHarness {
  app: FastifyInstance;
  secrets: ProviderSecrets;
  db: Database;
  outbox: AuthEmail[];
  jobs: {
    sources: ProcessSourceJob[];
    ai: AiJob[];
    recrawls: Array<[string, number | null]>;
    notifications: NotificationJob[];
    channels: ChannelJob[];
    mailboxes: Array<[string, boolean]>;
  };
  llm: MockLlmProvider;
  storage: InMemoryObjectStorage;
  kv: Kv;
  close: () => Promise<void>;
}

/**
 * Builds the API against the test database with in-memory/mock providers. Knowledge jobs
 * run inline, so tests can assert on processed results without a worker.
 */
export async function createHarness(
  options: Pick<
    AppDeps,
    | "voice"
    | "tts"
    | "sip"
    | "calendars"
    | "whatsapp"
    | "mailboxClient"
    | "humanCheck"
    | "billing"
    | "billingPrices"
    | "push"
    | "voiceTyping"
    | "demoSettings"
  > & {
    /** Record knowledge jobs without running them (e.g. demo websites that aren't real). */
    recordSourcesOnly?: boolean;
    llm?: LlmProvider;
    /** Check new passwords against Have I Been Pwned (stub `fetch` when on). */
    breachCheck?: boolean;
    /** Turn Better Auth's own request limits on (off by default: tests sign in a lot). */
    authRateLimit?: boolean;
  } = {},
): Promise<TestHarness> {
  loadRootEnv();
  const env = parseEnv({
    ...process.env,
    DATABASE_URL: requireEnv("TEST_DATABASE_URL"),
    LOG_LEVEL: "silent",
    PASSWORD_BREACH_CHECK: options.breachCheck ? "on" : "off",
  });
  const db = createDb(env.DATABASE_URL);
  const outbox: AuthEmail[] = [];
  const kv = memoryKv();
  const sendAuthEmail = (email: AuthEmail) => {
    outbox.push(email);
    return Promise.resolve();
  };
  const secrets: ProviderSecrets = { box: new SecretBox(randomBytes(32).toString("base64")) };
  const auth = createAppAuth(
    env,
    db,
    sendAuthEmail,
    options.authRateLimit ? kv : undefined,
    disconnectRemovedMembersCalendar(db, secrets, options.calendars),
  );
  const storage = new InMemoryObjectStorage();
  const embeddings = new MockEmbeddingProvider();
  const llm = new MockLlmProvider();
  const recorded: TestHarness["jobs"] = {
    sources: [],
    ai: [],
    recrawls: [],
    notifications: [],
    channels: [],
    mailboxes: [],
  };
  const jobs: JobDispatcher = {
    processSource: async (job) => {
      recorded.sources.push(job);
      if (options.recordSourcesOnly) return;
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
    notify: (job) => {
      recorded.notifications.push(job);
      return Promise.resolve();
    },
    dispatchChannel: (job) => {
      recorded.channels.push(job);
      return Promise.resolve();
    },
    scheduleMailbox: (tenantId, mailboxId, on) => {
      recorded.mailboxes.push([mailboxId, on]);
      return Promise.resolve();
    },
  };
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
    calendars: options.calendars,
    whatsapp: options.whatsapp ?? { accessToken: null, appSecret: null, verifyToken: null },
    mailboxClient: options.mailboxClient,
    humanCheck: options.humanCheck ?? null,
    billing: options.billing ?? null,
    billingPrices: options.billingPrices ?? {},
    push: options.push ?? null,
    voiceTyping: options.voiceTyping ?? null,
    demoSettings: options.demoSettings,
    oauthStateSecret: oauthStateSecretFor(env),
    freshAuth: freshAuthStore(kv),
    kv,
    sendAuthEmail,
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
    kv,
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

/** Confirms the password (step-up re-auth) so sensitive admin actions are allowed. */
export async function reauth(h: TestHarness, cookie: string): Promise<void> {
  const res = await h.app.inject({
    method: "POST",
    url: "/api/me/reauth",
    headers: { cookie, origin: ORIGIN },
    payload: { password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
}

/** Makes an account the platform owner, with two-step login on and a fresh password check. */
export async function makePlatformOwner(
  h: TestHarness,
  account: { email: string; cookie: string },
): Promise<void> {
  await h.db
    .update(user)
    .set({ isPlatformOwner: true, twoFactorEnabled: true })
    .where(eq(user.email, account.email));
  await reauth(h, account.cookie);
}

/** The signed token the website chat frame carries (security audit M3). */
export async function widgetToken(h: TestHarness, key: string): Promise<string> {
  const frame = await h.app.inject({ method: "GET", url: `/api/public/chat/${key}/frame` });
  const token = /"token":"([^"]+)"/.exec(frame.body)?.[1];
  if (!token) throw new Error("no widget token in the chat frame");
  return token;
}
