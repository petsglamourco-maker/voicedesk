import { createHash } from "node:crypto";
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
import { registerOriginCheck } from "./lib/origin-check";
import { registerAgentRoutes } from "./routes/agent";
import { registerConversationRoutes } from "./routes/conversations";
import { registerPlatformAudit, registerPlatformRoutes } from "./routes/platform";
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
import { registerCspReportRoute } from "./routes/csp-report";
import { registerOutboundRoutes } from "./routes/outbound";
import { registerSpendRoutes } from "./routes/spend";
import { registerFeedbackRoutes } from "./routes/feedback";
import { registerAssistantRoutes } from "./routes/assistant";
import { registerHelpRoutes } from "./routes/help";
import { registerDashboardRoutes } from "./routes/dashboard";
import { WhatsAppCloudProvider } from "@voicedesk/adapters/messaging/whatsapp-cloud";

export type AppDeps = Omit<Container, "close"> & {
  logLevel?: string;
  /** How staff replies reach the customer, per channel (website chat is built in). */
  channelSenders?: Partial<Record<TextChannel, ChannelSender>>;
  /** Browser-facing origin (website chat previews, links). */
  webOrigin?: string;
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/;

/** Rate-limit bucket: a hash of the session cookie when signed in, else the client IP. */
export function rateLimitKey(request: { headers: { cookie?: string }; ip: string }): string {
  const token = SESSION_COOKIE.exec(request.headers.cookie ?? "")?.[1];
  return token
    ? `s:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`
    : `ip:${request.ip}`;
}

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
    // Only these proxies may say who the client is (security audit H4): locally the Next.js
    // dev server on this machine. Anyone else's X-Forwarded-For is ignored.
    trustProxy: deps.trustedProxies ?? ["127.0.0.1", "::1"],
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  registerOriginCheck(app, deps.webOrigin ?? "http://localhost:3000");
  registerPlatformAudit(app, deps);

  // Shared across API processes (Valkey). Signed-in traffic is counted per session, so an
  // office behind one IP isn't throttled together; everything else per client IP.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    nameSpace: "api-rl:",
    ...(deps.rateLimitRedis ? { redis: deps.rateLimitRedis } : {}),
    keyGenerator: rateLimitKey,
  });
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

  registerAuthRoutes(app, deps);
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
  registerSpendRoutes(app, deps);
  registerCspReportRoute(app);
  registerFeedbackRoutes(app, deps);
  registerAssistantRoutes(app, deps);
  registerHelpRoutes(app, deps);
  registerDashboardRoutes(app, deps);

  return app;
}
