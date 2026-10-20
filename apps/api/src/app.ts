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
import type { TextChannel } from "@voicedesk/agent-brain";
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
import { registerInboxRoutes, type ChannelSender } from "./routes/inbox";
import { registerWhatsAppRoutes, whatsAppSender } from "./routes/whatsapp";
import { emailSender, registerMailboxRoutes } from "./routes/mailbox";
import { registerFormRoutes } from "./routes/forms";
import { registerVaRoutes } from "./routes/va";
import { registerOutboundRoutes } from "./routes/outbound";
import { WhatsAppCloudProvider } from "@voicedesk/adapters/messaging/whatsapp-cloud";

export type AppDeps = Omit<Container, "close"> & {
  logLevel?: string;
  /** How staff replies reach the customer, per channel (website chat is built in). */
  channelSenders?: Partial<Record<TextChannel, ChannelSender>>;
  /** Browser-facing origin (website chat previews, links). */
  webOrigin?: string;
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  deps = {
    ...deps,
    channelSenders: {
      // Website chat: the visitor's open widget receives the reply live (SSE).
      web_chat: { send: () => Promise.resolve() },
      email: emailSender(deps),
      // Form enquiries are answered by email when the person left an address.
      web_form: emailSender(deps),
      ...(deps.whatsapp?.accessToken
        ? {
            whatsapp: whatsAppSender(deps, async (phoneNumberId, to, text) => {
              const provider = new WhatsAppCloudProvider({
                accessToken: deps.whatsapp!.accessToken!,
              });
              await provider.sendText(phoneNumberId, { to, text });
            }),
          }
        : {}),
      ...deps.channelSenders,
    },
  };
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
  registerInboxRoutes(app, deps);
  registerWhatsAppRoutes(app, deps);
  registerMailboxRoutes(app, deps);
  registerFormRoutes(app, deps);
  registerVaRoutes(app, deps);
  registerOutboundRoutes(app, deps);

  return app;
}
