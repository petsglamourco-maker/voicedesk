import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Auth } from "@voicedesk/auth";
import { loggerOptions } from "@voicedesk/compliance/logger";
import type { Database } from "@voicedesk/db";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { registerAuthRoutes } from "./lib/auth-routes";
import { registerErrorHandler } from "./lib/errors";
import { registerHealthRoutes } from "./routes/health";
import { registerMeRoutes } from "./routes/me";
import { registerTenantRoutes } from "./routes/tenants";

export interface AppDeps {
  db: Database;
  auth: Auth;
  /** Returns true when Redis (queues) is reachable. */
  checkRedis: () => Promise<boolean>;
  logLevel?: string;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      ...loggerOptions("api", deps.logLevel),
      serializers: {
        // Query strings can carry tokens (e.g. email verification) — never log them.
        req: (req: { method: string; url: string; id: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split("?")[0],
        }),
      },
    },
    // Locally the Next.js dev server proxies /api/*; restrict to known proxies in production.
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: { title: "VoiceDesk API", version: "0.1.0" },
      components: {
        securitySchemes: {
          session: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  registerAuthRoutes(app, deps.auth);
  registerHealthRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerTenantRoutes(app, deps);

  return app;
}
