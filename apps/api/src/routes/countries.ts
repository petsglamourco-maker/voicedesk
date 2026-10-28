import { COUNTRIES, SUPPORTED_COUNTRY_CODES } from "@voicedesk/compliance";
import { getCountrySettings, launchedCountries, saveCountrySettings } from "@voicedesk/core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requirePlatformOwner } from "./platform";

/**
 * Countries (ADR 0031): which country packs businesses can sign up in. Packs ship in code as
 * "preview"; the platform owner launches each one after legal review.
 */
export function registerCountryRoutes(app: FastifyInstance, deps: AppDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = (code: string) => {
    const pack = COUNTRIES[code]!;
    return {
      code,
      name: pack.name,
      currency: pack.currency,
      locale: pack.locale,
      timezones: pack.timezones,
    };
  };

  r.get(
    "/api/public/countries",
    { schema: { tags: ["countries"], summary: "Countries businesses can sign up in" } },
    async () => {
      const settings = deps.countrySettings ?? (await getCountrySettings(deps.db));
      return { countries: launchedCountries(settings).map(view) };
    },
  );

  r.get(
    "/api/platform/countries",
    { schema: { tags: ["platform"], summary: "Every country pack, and which are launched" } },
    async (request) => {
      await requirePlatformOwner(deps, request);
      const settings = await getCountrySettings(deps.db);
      const launched = launchedCountries(settings);
      return {
        countries: SUPPORTED_COUNTRY_CODES.map((code) => {
          const pack = COUNTRIES[code]!;
          return {
            ...view(code),
            status: pack.status,
            launched: launched.includes(code),
            emergencyNumber: pack.emergencyNumbers[0] ?? null,
            needsLegalReview:
              pack.outbound.needsLegalReview ||
              pack.recording.needsLegalReview ||
              pack.numbers.needsLegalReview,
            smsRegistration: pack.sms.registration,
            smsRegistered: settings.smsRegistered.includes(code),
          };
        }),
      };
    },
  );

  r.put(
    "/api/platform/countries",
    {
      schema: {
        tags: ["platform"],
        summary: "Launch countries (after legal review) and record texting registration",
        body: z.object({
          launched: z.array(z.string()).max(50),
          smsRegistered: z.array(z.string()).max(50),
        }),
      },
    },
    async (request) => {
      const session = await requirePlatformOwner(deps, request);
      return saveCountrySettings(deps.db, request.body, session.user.id);
    },
  );
}
