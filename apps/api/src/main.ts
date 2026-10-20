import { dirname } from "node:path";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { buildApp } from "./app";
import { createContainer } from "./container";
import { parseEnv } from "./env";
import { startOutboundDialer } from "./lib/outbound-dialer";

const envFile = loadRootEnv();
const env = parseEnv();
const container = await createContainer(env, envFile ? dirname(envFile) : process.cwd());
const app = await buildApp({ ...container, logLevel: env.LOG_LEVEL, webOrigin: env.WEB_ORIGIN });

// Calls the assistant places itself (Phase 6): only once LiveKit is configured.
const stopDialer =
  container.sip && container.voice
    ? startOutboundDialer({
        db: container.db,
        sip: container.sip,
        voice: container.voice,
        log: { info: (o, m) => app.log.info(o, m), warn: (o, m) => app.log.warn(o, m) },
      })
    : () => undefined;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  stopDialer();
  await app.close();
  await container.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.API_PORT, host: "127.0.0.1" });
