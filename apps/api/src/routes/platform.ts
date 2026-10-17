import {
  listProviderRows,
  listServerModels,
  providerUpdateSchema,
  reorderProviders,
  testProvider,
  toView,
  updateProvider,
} from "@voicedesk/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError, notFound } from "../lib/errors";
import { requireSession } from "./guards";

/** Platform-owner-only settings. Everyone else gets 404 (the routes don't "exist" for them). */
export async function requirePlatformOwner(deps: AppDeps, request: FastifyRequest) {
  const session = await requireSession(deps.auth, request);
  if (!session.user.isPlatformOwner) throw notFound();
  return session;
}

const idParams = z.object({ id: z.string().uuid() });

export function registerPlatformRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["platform"];
  const views = async () =>
    (await listProviderRows(deps.db)).map((row) => toView(row, deps.secrets));

  r.get(
    "/api/platform/ai-providers",
    { schema: { tags, summary: "AI providers in priority order (API keys are never returned)" } },
    async (request) => {
      await requirePlatformOwner(deps, request);
      return { providers: await views(), encryptionConfigured: deps.secrets.box !== null };
    },
  );

  r.put(
    "/api/platform/ai-providers/:id",
    {
      schema: {
        tags,
        summary: "Switch a provider on/off or change its URL, models, options or API key",
        params: idParams,
        body: providerUpdateSchema,
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      try {
        const row = await updateProvider(
          deps.db,
          deps.secrets,
          session.user.id,
          request.params.id,
          request.body,
        );
        if (!row) throw notFound();
        deps.llm.invalidate?.();
        return toView(row, deps.secrets);
      } catch (error) {
        if (error instanceof Error && /SETTINGS_ENCRYPTION_KEY/.test(error.message)) {
          throw new HttpError(400, "ENCRYPTION_NOT_CONFIGURED", error.message);
        }
        throw error;
      }
    },
  );

  r.post(
    "/api/platform/ai-providers/order",
    {
      schema: {
        tags,
        summary: "Set the priority order (first = tried first)",
        body: z.object({ ids: z.array(z.string().uuid()).min(1) }),
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      const existing = new Set((await listProviderRows(deps.db)).map((p) => p.id));
      const ids = request.body.ids;
      if (ids.length !== existing.size || !ids.every((id) => existing.has(id))) {
        throw new HttpError(400, "INVALID_ORDER", "Send every provider id exactly once");
      }
      await reorderProviders(deps.db, session.user.id, ids);
      deps.llm.invalidate?.();
      return { providers: await views() };
    },
  );

  r.post(
    "/api/platform/ai-providers/:id/test",
    {
      schema: {
        tags,
        summary: "Send a tiny live request (and a tool call) to check the provider works",
        params: idParams,
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      const result = await testProvider(deps.db, deps.secrets, session.user.id, request.params.id);
      if (!result) throw notFound();
      return result;
    },
  );

  r.get(
    "/api/platform/ai-providers/:id/models",
    {
      schema: {
        tags,
        summary: "Models offered by an OpenAI-compatible server",
        params: idParams,
      },
    },
    async (request) => {
      await requirePlatformOwner(deps, request);
      const row = (await listProviderRows(deps.db)).find((p) => p.id === request.params.id);
      if (!row) throw notFound();
      try {
        return { models: await listServerModels(row, deps.secrets) };
      } catch (error) {
        throw new HttpError(
          502,
          "SERVER_UNREACHABLE",
          error instanceof Error ? error.message : "Could not reach the server",
        );
      }
    },
  );
}
