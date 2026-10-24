import { checkSend } from "./send-guard";
import { getPlatformSpendSettings, spendStatus } from "./spend";
import type { EmbeddingProvider } from "@voicedesk/adapters";
import {
  markCalendarError,
  markCalendarHealthy,
  tenantCalendar,
  type CalendarFactory,
  type SecretBox,
  type TenantCalendar,
} from "@voicedesk/core";
import { getCountryConfig } from "@voicedesk/compliance";
import {
  agentSettings,
  auditLog,
  bookings,
  channelThreads,
  contacts,
  conversations,
  knowledgeGaps,
  staffMessages,
  tenants,
  tickets,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { searchKnowledge } from "@voicedesk/knowledge";
import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import type { AgentContext } from "./context";
import { toLang } from "./languages";
import { upsertContactByPhone } from "./contacts";
import { getPersona } from "./personas";
import { handoffPlan, isOpenNow, PEOPLE_TARGET, toHandoffRoute, transferTarget } from "./transfer";
import { getApprovedProfile } from "./profile-store";
import type { BusyRange } from "./availability";
import type { AgentServices, Created } from "./services";
import { makeReference } from "./util";

export interface DbServiceDeps {
  db: Database;
  embeddings: EmbeddingProvider;
  /** External calendar access (Phase 3). Without it, only VoiceDesk's own bookings count. */
  calendars?: {
    box: SecretBox | null;
    factory: CalendarFactory | null;
    log?: (message: string, data: Record<string, unknown>) => void;
  };
  /**
   * Tells the notifications worker what happened (customer confirmations, reminders, staff
   * alerts). Failures are logged, never thrown: a booking stands even if a text can't be sent.
   */
  notify?: (event: AgentNotification) => Promise<void>;
}

/** What the agent did that someone should hear about (see NotificationJob in @voicedesk/jobs). */
export type AgentNotification =
  | { kind: "booking.changed"; bookingId: string; change: "created" | "moved" | "cancelled" }
  | { kind: "staff.alert"; record: "ticket" | "message" | "handoff" | "feedback"; id: string }
  | { kind: "transfer.context"; conversationId: string; to: string; reason: string };

const BUSY_CACHE_MS = 60_000;
const busyCache = new Map<string, { at: number; ranges: BusyRange[] }>();

/** Drops cached external busy times for a business (after it books or cancels). */
export function invalidateBusyCache(tenantId: string): void {
  for (const key of busyCache.keys()) if (key.startsWith(`${tenantId}|`)) busyCache.delete(key);
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
  scope: {
    tenantId: string;
    conversationId: string;
    businessName: string;
    timezone?: string;
    /** Phone calls only: the caller can be put through to a person (SIP transfer). */
    canTransfer?: boolean;
    /** Inbox channels (web chat, WhatsApp, email): a person can pick up this thread. */
    handoffThreadId?: string;
    /** Phone calls: whether someone at the VA console can take the call now (Phase 5). */
    peopleAvailable?: () => Promise<boolean>;
  },
): AgentServices {
  const { db } = deps;
  const { tenantId, conversationId, businessName } = scope;
  const tx = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, tenantId, fn);
  const log = deps.calendars?.log ?? (() => undefined);
  const notify = async (event: AgentNotification) => {
    try {
      await deps.notify?.(event);
    } catch (error) {
      log("notification failed", { tenantId, kind: event.kind, err: String(error) });
    }
  };

  /** The person a record is about: found or created by phone; also links the conversation. */
  async function contactFor(
    t: Parameters<Parameters<typeof withTenant>[2]>[0],
    person: { phone: string | null | undefined; name?: string | null; email?: string | null },
  ): Promise<string | null> {
    const contactId = await upsertContactByPhone(t, tenantId, person);
    if (contactId) {
      await t
        .update(conversations)
        .set({ contactId })
        .where(and(eq(conversations.id, conversationId), isNull(conversations.contactId)));
    }
    return contactId;
  }

  let calendar: Promise<TenantCalendar | null> | undefined;
  const getCalendar = () =>
    (calendar ??= deps.calendars
      ? tenantCalendar(db, deps.calendars.box, deps.calendars.factory, tenantId).catch(
          (error: unknown) => {
            log("calendar unavailable", { tenantId, err: String(error) });
            return null;
          },
        )
      : Promise.resolve(null));

  /** Runs a calendar call; failures never break the conversation, they're shown to the business. */
  async function withCalendar<T>(
    what: string,
    fn: (cal: TenantCalendar) => Promise<T>,
  ): Promise<T | undefined> {
    const cal = await getCalendar();
    if (!cal) return undefined;
    try {
      const result = await fn(cal);
      return result;
    } catch (error) {
      log(`calendar ${what} failed`, { tenantId, err: String(error) });
      await markCalendarError(db, tenantId, cal.connectionId, error).catch(() => undefined);
      return undefined;
    }
  }

  return {
    async searchKnowledge(query) {
      return searchKnowledge(deps, tenantId, query, { limit: 4, minScore: 0.7 });
    },

    async listBusy(from, to) {
      const own = await tx((t) =>
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
      // Busy times from the business's own calendar (cached briefly: several tool calls in a
      // turn ask about the same day). Bookings we made are also in there; overlap is harmless.
      const key = `${tenantId}|${from.toISOString()}|${to.toISOString()}`;
      const cached = busyCache.get(key);
      let external = cached && Date.now() - cached.at < BUSY_CACHE_MS ? cached.ranges : undefined;
      if (!external) {
        const ranges = await withCalendar("free/busy", async (cal) => {
          const busy = await cal.provider.freeBusy([cal.calendarId], { start: from, end: to });
          return busy.map((b) => ({ startsAt: b.start, endsAt: b.end }));
        });
        if (ranges) {
          busyCache.set(key, { at: Date.now(), ranges });
          external = ranges;
        }
      }
      return [...own, ...(external ?? [])];
    },

    async findBookings(query) {
      const rows = await tx((t) =>
        t
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.tenantId, tenantId),
              eq(bookings.status, "confirmed"),
              gt(bookings.startsAt, new Date()),
              ...(query.reference ? [eq(bookings.reference, query.reference)] : []),
              ...(query.phone ? [eq(bookings.customerPhone, query.phone)] : []),
            ),
          )
          .orderBy(asc(bookings.startsAt))
          .limit(10),
      );
      return rows.map((b) => ({
        id: b.id,
        reference: b.reference,
        service: b.service,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
      }));
    },

    async cancelBooking(bookingId) {
      const [row] = await tx((t) =>
        t
          .update(bookings)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
          .returning(),
      );
      if (row?.externalEventId) {
        const eventId = row.externalEventId;
        await withCalendar("delete event", (cal) =>
          cal.provider.deleteEvent(cal.calendarId, eventId),
        );
      }
      invalidateBusyCache(tenantId);
      if (row) await notify({ kind: "booking.changed", bookingId, change: "cancelled" });
    },

    async rescheduleBooking(bookingId, startsAt, endsAt) {
      const [row] = await tx((t) =>
        t
          .update(bookings)
          .set({ startsAt, endsAt, updatedAt: new Date() })
          .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
          .returning(),
      );
      if (row?.externalEventId) {
        const eventId = row.externalEventId;
        await withCalendar("move event", (cal) =>
          cal.provider.updateEvent(cal.calendarId, eventId, {
            start: startsAt,
            end: endsAt,
            timezone: scope.timezone ?? "UTC",
          }),
        );
      }
      invalidateBusyCache(tenantId);
      if (row) await notify({ kind: "booking.changed", bookingId, change: "moved" });
    },

    async createTicket(input) {
      const d = input.details;
      const created = await withReference(businessName, (reference) =>
        tx(async (t): Promise<Created> => {
          const contactId = await contactFor(t, {
            phone: d.callbackPhone,
            name: d.callerName,
            email: d.emailConfirmed ? d.email : null,
          });
          const [row] = await t
            .insert(tickets)
            .values({
              tenantId,
              reference,
              conversationId,
              contactId,
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
      // Urgent problems and callback requests shouldn't wait for the end-of-call summary.
      if (input.priority === "urgent" || input.priority === "high" || d.wantsCallback) {
        await notify({ kind: "staff.alert", record: "ticket", id: created.id });
      }
      return created;
    },

    async createBooking(input) {
      const created = await withReference(businessName, (reference) =>
        tx(async (t): Promise<Created> => {
          const contactId = await contactFor(t, {
            phone: input.customerPhone,
            name: input.customerName,
            email: input.customerEmail,
          });
          const [row] = await t
            .insert(bookings)
            .values({ tenantId, reference, conversationId, contactId, ...input })
            .returning({ id: bookings.id });
          return { id: row!.id, reference };
        }),
      );
      // Put it in the business's calendar too. If that fails the booking still stands (it is
      // in VoiceDesk and blocks the slot); the business sees the error on Integrations.
      await withCalendar("create event", async (cal) => {
        const event = await cal.provider.createEvent(cal.calendarId, {
          title: `${input.service} — ${input.customerName}`,
          description: [
            `Booked by the VoiceDesk assistant. Reference ${created.reference}.`,
            input.customerPhone ? `Phone: ${input.customerPhone}` : null,
            input.customerEmail ? `Email: ${input.customerEmail}` : null,
            input.notes ? `Notes: ${input.notes}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          start: input.startsAt,
          end: input.endsAt,
          timezone: scope.timezone ?? "UTC",
        });
        await tx((t) =>
          t
            .update(bookings)
            .set({ calendarConnectionId: cal.connectionId, externalEventId: event.id })
            .where(eq(bookings.id, created.id)),
        );
        await markCalendarHealthy(db, tenantId, cal.connectionId);
      });
      invalidateBusyCache(tenantId);
      await notify({ kind: "booking.changed", bookingId: created.id, change: "created" });
      return created;
    },

    async takeMessage(input) {
      const created = await withReference(businessName, (reference) =>
        tx(async (t): Promise<Created> => {
          const contactId = await contactFor(t, {
            phone: input.callerPhone,
            name: input.callerName,
          });
          const [row] = await t
            .insert(staffMessages)
            .values({
              tenantId,
              reference,
              conversationId,
              contactId,
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
      if (input.urgency === "high") {
        await notify({ kind: "staff.alert", record: "message", id: created.id });
      }
      return created;
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

    async requestHuman(reason, options = {}) {
      const reference = makeReference(businessName);
      let transferTo: string | undefined;
      let transferFallback: string | undefined;
      if (scope.canTransfer) {
        const [settings] = await tx((t) =>
          t.select().from(agentSettings).where(eq(agentSettings.tenantId, tenantId)),
        );
        const profile = await getApprovedProfile(db, tenantId);
        const target = transferTarget(
          {
            transferPhone: settings?.transferPhone ?? null,
            transferHours: settings?.transferHours === "always" ? "always" : "open",
            onCallPhone: settings?.onCallPhone ?? null,
          },
          isOpenNow(profile, scope.timezone ?? "Europe/London", new Date()),
          options.urgent === true,
        );
        // A transfer is an outbound call leg: same checks as any call (ADR 0022).
        const phone =
          target && (await checkSend(db, { tenantId, kind: "call", to: target })).ok
            ? target
            : null;
        const route = toHandoffRoute(settings?.handoffRoute);
        const people =
          route !== "phone_only" && scope.peopleAvailable
            ? await scope.peopleAvailable().catch(() => false)
            : false;
        const plan = handoffPlan(route, people, phone);
        transferTo = plan?.to;
        transferFallback = plan?.fallback;
      }
      await tx((t) =>
        t.insert(auditLog).values({
          tenantId,
          actorType: "ai",
          action: "conversation.human_requested",
          targetType: "conversation",
          targetId: conversationId,
          metadata: {
            reason: reason.slice(0, 200),
            reference,
            urgent: options.urgent === true,
            transfer: transferTo !== undefined,
          },
        }),
      );
      if (transferTo) {
        // Context for the person about to answer a phone transfer: who's calling and why.
        // (At the VA console the context is on screen.)
        if (transferTo !== PEOPLE_TARGET) {
          await notify({
            kind: "transfer.context",
            conversationId,
            to: transferTo,
            reason: reason.slice(0, 200),
          });
        }
        return { id: conversationId, reference, available: true, transferTo, transferFallback };
      }
      if (scope.handoffThreadId) {
        const threadId = scope.handoffThreadId;
        await tx((t) =>
          t
            .update(channelThreads)
            .set({ needsHuman: true, updatedAt: new Date() })
            .where(eq(channelThreads.id, threadId)),
        );
        await notify({ kind: "staff.alert", record: "handoff", id: threadId });
        return { id: conversationId, reference, available: true, handoff: true };
      }
      return { id: conversationId, reference, available: false };
    },
  };
}

/** Builds the agent context for a tenant from its settings and approved profile. */
export async function loadAgentContext(
  db: Database,
  tenantId: string,
  style: "chat" | "voice" | "email",
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
    urgentSituations: settings?.urgentSituations ?? null,
    ...(await aiPauseFor(db, tenantId, now(), tenant.status)),
    now,
  };
}

/** Whether this business's conversations run without AI right now (ADR 0022). */
export async function aiPauseFor(
  db: Database,
  tenantId: string,
  now: Date = new Date(),
  knownStatus?: string,
): Promise<Pick<AgentContext, "aiPaused" | "suspended">> {
  const status =
    knownStatus ??
    (
      await withTenant(db, tenantId, (t) =>
        t.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId)),
      )
    )[0]?.status;
  if (status === "suspended") return { aiPaused: "platform", suspended: true };
  const platform = await getPlatformSpendSettings(db);
  if (platform.paused.ai) return { aiPaused: "platform", suspended: false };
  const spend = await spendStatus(db, tenantId, now);
  return { aiPaused: spend.categories.ai.state === "reached" ? "cap" : null, suspended: false };
}
