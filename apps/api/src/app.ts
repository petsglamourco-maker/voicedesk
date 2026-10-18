import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import multipart from "@fastify/multipart";
import { loggerOptions } from "@voicedesk/compliance/logger";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Container } from "./container";
import { registerAuthRoutes } from "./lib/auth-routes";
import { registerAgentRoutes } from "./routes/agent";
import { registerConversationRoutes } from "./routes/conversations";
import { registerPlatformRoutes } from "./routes/platform";
import { registerErrorHandler } from "./lib/errors";
import { registerHealthRoutes } from "./routes/health";
import { registerKnowledgeRoutes } from "./routes/knowledge";
import { registerMeRoutes } from "./routes/me";
import { registerProfileRoutes } from "./routes/profile";
import { registerTenantRoutes } from "./routes/tenants";
import { registerVoiceRoutes } from "./routes/voice";
import { registerPhoneNumberRoutes } from "./routes/phone-numbers";
import { registerCallRoutes } from "./routes/calls";
import { registerIntegrationRoutes } from "./routes/integrations";
import { registerContactRoutes } from "./routes/contacts";
import { registerPublicChatRoutes } from "./routes/public-chat";
import { registerWidgetSettingsRoutes } from "./routes/widget-settings";

export type AppDeps = Omit<Container, "close"> & {
  logLevel?: string;
  /** Browser-facing origin (website chat previews, links). */
  webOrigin?: string;
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } });

  registerAuthRoutes(app, deps.auth);
  registerHealthRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerTenantRoutes(app, deps);
  registerKnowledgeRoutes(app, deps);
  registerProfileRoutes(app, deps);
  registerAgentRoutes(app, deps);
  registerConversationRoutes(app, deps);
  registerPlatformRoutes(app, deps);
  registerVoiceRoutes(app, deps);
  registerPhoneNumberRoutes(app, deps);
  registerCallRoutes(app, deps);
  registerIntegrationRoutes(app, deps);
  registerContactRoutes(app, deps);
  registerPublicChatRoutes(app, deps);
  registerWidgetSettingsRoutes(app, deps);

  return app;
}
