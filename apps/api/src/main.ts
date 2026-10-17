import { dirname } from "node:path";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { buildApp } from "./app";
import { createContainer } from "./container";
import { parseEnv } from "./env";

const envFile = loadRootEnv();
const env = parseEnv();
const container = await createContainer(env, envFile ? dirname(envFile) : process.cwd());
const app = await buildApp({ ...container, logLevel: env.LOG_LEVEL });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await container.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.API_PORT, host: "127.0.0.1" });
