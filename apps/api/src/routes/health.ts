import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/api/health",
    {
      schema: {
        tags: ["system"],
        response: {
          200: z.object({ status: z.literal("ok"), database: z.boolean(), redis: z.boolean() }),
          503: z.object({
            status: z.literal("degraded"),
            database: z.boolean(),
            redis: z.boolean(),
          }),
        },
      },
    },
    async (_request, reply) => {
      const database = await deps.db
        .execute(sql`select 1`)
        .then(() => true)
        .catch(() => false);
      const redis = await deps.checkRedis().catch(() => false);
      if (database && redis) return { status: "ok" as const, database, redis };
      return reply.status(503).send({ status: "degraded" as const, database, redis });
    },
  );
}
