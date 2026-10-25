import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CreateDbOptions {
  maxConnections?: number;
  /**
   * Connection for cross-business work (withPlatformAccess), as the separate
   * voicedesk_platform login (security audit M11). Defaults from the environment:
   * DATABASE_PLATFORM_URL for DATABASE_URL, TEST_DATABASE_PLATFORM_URL for TEST_DATABASE_URL.
   * Pass null to have none.
   */
  platformUrl?: string | null;
}

interface PlatformPool {
  url: string;
  db?: Database;
}
const platformPools = new WeakMap<Database, PlatformPool>();

function defaultPlatformUrl(url: string): string | undefined {
  const env = process.env;
  if (url === env.DATABASE_URL) return env.DATABASE_PLATFORM_URL || undefined;
  if (url === env.TEST_DATABASE_URL) return env.TEST_DATABASE_PLATFORM_URL || undefined;
  return undefined;
}

/** Creates a pooled Drizzle client. Use the RLS-bound app role URL at runtime. */
export function createDb(url: string, options: CreateDbOptions = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max: options.maxConnections ?? 10 });
  const db = drizzle({ client: pool, schema });
  const platformUrl =
    options.platformUrl === undefined ? defaultPlatformUrl(url) : options.platformUrl;
  if (platformUrl) platformPools.set(db, { url: platformUrl });
  return db;
}

/**
 * The client withPlatformAccess runs on: the platform login's pool (opened on first use),
 * or the same client when none is configured (then app_platform_access() stays off for the
 * app role, so cross-business reads return nothing rather than leaking).
 */
export function platformDbFor(db: Database): Database {
  const entry = platformPools.get(db);
  if (!entry) return db;
  entry.db ??= drizzle({
    client: new pg.Pool({ connectionString: entry.url, max: 3 }),
    schema,
  });
  return entry.db;
}

export async function closeDb(db: Database): Promise<void> {
  const platform = platformPools.get(db)?.db;
  await Promise.all([db.$client.end(), platform?.$client.end()]);
}
