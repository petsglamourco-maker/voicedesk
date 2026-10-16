import { createAuth, type Auth, type AuthAuditEvent, type AuthEmail } from "@voicedesk/auth";
import { recordAudit } from "@voicedesk/core";
import { closeDb, createDb, withTenant, type Database } from "@voicedesk/db";
import { createEmailQueue, createRedisConnection } from "@voicedesk/jobs";
import type { Env } from "./env";

export function createAuditSink(db: Database): (event: AuthAuditEvent) => Promise<void> {
  return async (event) => {
    const entry = { ...event, actorType: "user" as const };
    if (event.tenantId) {
      await withTenant(db, event.tenantId, (tx) => recordAudit(tx, entry));
    } else {
      await db.transaction((tx) => recordAudit(tx, entry));
    }
  };
}

export function createAppAuth(
  env: Env,
  db: Database,
  sendEmail: (email: AuthEmail) => Promise<void>,
): Auth {
  return createAuth({
    db,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN],
    sendEmail,
    audit: createAuditSink(db),
  });
}

export interface Container {
  db: Database;
  auth: Auth;
  checkRedis: () => Promise<boolean>;
  close: () => Promise<void>;
}

/** Production/dev wiring: auth emails are queued and delivered by apps/workers. */
export function createContainer(env: Env): Container {
  const db = createDb(env.DATABASE_URL);
  const redis = createRedisConnection(env.REDIS_URL);
  const emailQueue = createEmailQueue(redis);
  const auth = createAppAuth(env, db, async (email) => {
    await emailQueue.add(email.kind, email);
  });

  return {
    db,
    auth,
    checkRedis: async () => (await redis.ping()) === "PONG",
    close: async () => {
      await emailQueue.close();
      redis.disconnect();
      await closeDb(db);
    },
  };
}
