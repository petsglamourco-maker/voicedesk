import type { EmbeddingProvider } from "@voicedesk/adapters";
import { getCountryConfig } from "@voicedesk/compliance";
import {
  agentSettings,
  auditLog,
  bookings,
  contacts,
  knowledgeGaps,
  staffMessages,
  tenants,
  tickets,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { searchKnowledge } from "@voicedesk/knowledge";
import { and, eq, gt, lt } from "drizzle-orm";
import type { AgentContext } from "./context";
import { toLang } from "./languages";
import { getPersona } from "./personas";
import { getApprovedProfile } from "./profile-store";
import type { AgentServices, Created } from "./services";
import { makeReference } from "./util";

export interface DbServiceDeps {
  db: Database;
  embeddings: EmbeddingProvider;
}

/** Postgres unique violation, possibly wrapped by Drizzle ("Failed query: ..."). */
function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (e as { code?: string } | undefined)?.code;
  return code(error) === "23505" || code((error as { cause?: unknown })?.cause) === "23505";
}

/** Inserts with a fresh human-friendly reference, retrying on the rare collision. */
async function withReference<T>(
  businessName: string,
  insert: (reference: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await insert(makeReference(businessName));
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 5) throw error;
    }
  }
}

/** Agent side effects backed by the tenant's database (RLS-scoped). */
export function createDbAgentServices(
  deps: DbServiceDeps,
  scope: { tenantId: string; conversationId: string; businessName: string },
): AgentServices {
  const { db } = deps;
  const { tenantId, conversationId, businessName } = scope;
  const tx = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, tenantId, fn);

  return {
    async searchKnowledge(query) {
      return searchKnowledge(deps, tenantId, query, { limit: 4, minScore: 0.7 });
    },

    async listBusy(from, to) {
      return tx((t) =>
        t
          .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
          .from(bookings)
          .where(
            and(
              eq(bookings.tenantId, tenantId),
              eq(bookings.status, "confirmed"),
              lt(bookings.startsAt, to),
              gt(bookings.endsAt, from),
            ),
          ),
      );
    },

    async createTicket(input) {
      const d = input.details;
      return withReference(businessName, (reference) =>
        tx(async (t): Promise<Created> => {
          const [row] = await t
            .insert(tickets)
            .values({
              tenantId,
              reference,
              conversationId,
              priority: input.priority,
              details: d,
              callbackPhone: d.callbackPhone ?? null,
              callbackEmail: d.email ?? null,
              callbackTime: d.callbackTime ?? null,
              contactConsent: d.contactConsent ?? false,
              summary: input.summary,
            })
            .returning({ id: tickets.id });
          return { id: row!.id, reference };
        }),
      );
    },

    async createBooking(input) {
      return withReference(businessName, (reference) =>
        tx(async (t): Promise<Created> => {
          const [row] = await t
            .insert(bookings)
            .values({ tenantId, reference, conversationId, ...input })
            .returning({ id: bookings.id });
          return { id: row!.id, reference };
        }),
      );
    },

    async takeMessage(input) {
      return withReference(businessName, (reference) =>
        tx(async (t): Promise<Created> => {
          const [row] = await t
            .insert(staffMessages)
            .values({
              tenantId,
              reference,
              conversationId,
              callerName: input.callerName,
              callerPhone: input.callerPhone,
              forStaff: input.forStaff ?? null,
              reason: input.reason,
              urgency: input.urgency,
              bestTime: input.bestTime ?? null,
            })
            .returning({ id: staffMessages.id });
          return { id: row!.id, reference };
        }),
      );
    },

    async registerCustomer(input) {
      const reference = makeReference(businessName);
      const values = {
        tenantId,
        fullName: input.fullName,
        phoneE164: input.phone,
        email: input.email,
        interest: input.interest,
        source: "assistant",
        marketingConsent: input.marketingConsent,
        consentAt: input.marketingConsent ? new Date() : null,
        reference,
      };
      const id = await tx(async (t) => {
        // A returning caller with the same number updates their contact rather than duplicating it.
        if (input.phone) {
          const [existing] = await t
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phoneE164, input.phone)));
          if (existing) {
            await t.update(contacts).set(values).where(eq(contacts.id, existing.id));
            return existing.id;
          }
        }
        const [row] = await t.insert(contacts).values(values).returning({ id: contacts.id });
        return row!.id;
      });
      return { id, reference };
    },

    async noteKnowledgeGap(question) {
      await tx((t) =>
        t
          .insert(knowledgeGaps)
          .values({ tenantId, conversationId, question: question.slice(0, 500) }),
      );
    },

    async requestHuman(reason) {
      // Live transfer arrives with the VA console (Phase 5); for now record the request.
      const reference = makeReference(businessName);
      await tx((t) =>
        t.insert(auditLog).values({
          tenantId,
          actorType: "ai",
          action: "conversation.human_requested",
          targetType: "conversation",
          targetId: conversationId,
          metadata: { reason: reason.slice(0, 200), reference },
        }),
      );
      return { id: conversationId, reference, available: false };
    },
  };
}

/** Builds the agent context for a tenant from its settings and approved profile. */
export async function loadAgentContext(
  db: Database,
  tenantId: string,
  style: "chat" | "voice",
  now: () => Date = () => new Date(),
): Promise<AgentContext> {
  const { tenant, settings } = await withTenant(db, tenantId, async (t) => ({
    tenant: (await t.select().from(tenants).where(eq(tenants.id, tenantId)))[0],
    settings: (await t.select().from(agentSettings).where(eq(agentSettings.tenantId, tenantId)))[0],
  }));
  if (!tenant) throw new Error("tenant not found");
  const persona = getPersona(settings?.personaId ?? "amelia");
  const profile = await getApprovedProfile(db, tenantId);
  let emergencyNumber = "112";
  try {
    emergencyNumber = getCountryConfig(tenant.countryCode).emergencyNumbers[0] ?? "112";
  } catch {
    // unsupported country: 112 works across Europe and on most mobile networks
  }
  return {
    businessName: profile?.businessName || tenant.name,
    countryCode: tenant.countryCode,
    timezone: tenant.timezone,
    defaultLanguage: toLang(tenant.defaultLanguage),
    persona,
    personaName: settings?.personaNames[persona.id] || persona.defaultName,
    profile,
    style,
    emergencyNumber,
    recordCalls: settings?.recordCalls ?? false,
    voiceIds: settings?.voiceIds ?? {},
    now,
  };
}
