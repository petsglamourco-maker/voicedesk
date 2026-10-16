import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CreateDbOptions {
  maxConnections?: number;
}

/** Creates a pooled Drizzle client. Use the RLS-bound app role URL at runtime. */
export function createDb(url: string, options: CreateDbOptions = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max: options.maxConnections ?? 10 });
  return drizzle({ client: pool, schema });
}

export async function closeDb(db: Database): Promise<void> {
  await db.$client.end();
}
