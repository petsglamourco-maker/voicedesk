import {
  claimDueOutboundCalls,
  createOutboundConversation,
  decideOutboundCall,
  finishOutboundAttempt,
  loadAgentContext,
  outboundCallContext,
  reapStaleOutboundCalls,
  type OutboundCallRow,
  type OutboundPurpose,
} from "@voicedesk/agent-brain";
import { organization, phoneNumbers, tenants, withTenant, type Database } from "@voicedesk/db";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { carrierOf } from "./phone-numbers";
import type { SipGateway } from "./sip";
import type { VoiceGateway } from "./voice";

/**
 * Places the calls the assistant makes itself (Phase 6, ADR 0019). Every minute: claim due
 * calls per business, check the rules, create the conversation, send the assistant into a
 * room, then ring the customer from the business's number. The voice worker reports how it
 * went (answered / voicemail / no answer).
 */

export interface DialerDeps {
  db: Database;
  sip: SipGateway;
  voice: VoiceGateway;
  log: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
  };
}

export const DIAL_EVERY_MS = 60_000;

export async function placeOutboundCall(
  deps: DialerDeps,
  call: OutboundCallRow,
  now: Date,
): Promise<string> {
  const { db } = deps;
  const ctx = await outboundCallContext(db, call, now);
  const [found] = await withTenant(db, call.tenantId, (tx) =>
    tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, call.tenantId)),
  );
  const timezone = found?.timezone ?? "Europe/London";
  const decision = decideOutboundCall({
    now,
    timezone,
    purpose: call.purpose as OutboundPurpose,
    enabled: {
      callbacks: ctx.settings?.aiCallbacks ?? false,
      confirmations: ctx.settings?.confirmationCalls ?? false,
    },
    doNotCall: ctx.contact?.doNotCall === true,
    callsToday: ctx.callsToday,
    dailyCap: ctx.settings?.outboundDailyCap ?? 20,
    bookingStillOn: ctx.booking
      ? ctx.booking.status !== "cancelled" && ctx.booking.startsAt > now
      : undefined,
  });
  if (decision.action === "later") {
    await finishOutboundAttempt(db, call, {
      status: "later",
      at: decision.at,
      reason: decision.reason,
    });
    return `later: ${decision.reason}`;
  }
  if (decision.action === "cancel") {
    await finishOutboundAttempt(db, call, { status: "cancelled", reason: decision.reason });
    return `cancelled: ${decision.reason}`;
  }
  const [number] = await withTenant(db, call.tenantId, (tx) =>
    tx
      .select()
      .from(phoneNumbers)
      .where(
        and(
          eq(phoneNumbers.tenantId, call.tenantId),
          eq(phoneNumbers.status, "active"),
          isNotNull(phoneNumbers.livekitTrunkId),
        ),
      )
      .orderBy(asc(phoneNumbers.createdAt))
      .limit(1),
  );
  const carrier = number ? carrierOf(number) : null;
  if (!number || !carrier || !deps.sip.canDial(carrier)) {
    await finishOutboundAttempt(db, call, {
      status: "failed",
      reason: "outbound calling isn't set up for this business's number",
    });
    return "failed: not set up";
  }
  const agentCtx = await loadAgentContext(db, call.tenantId, "voice");
  const when = ctx.booking
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(ctx.booking.startsAt)
    : "";
  const conversation = await createOutboundConversation(db, agentCtx, {
    tenantId: call.tenantId,
    phone: call.phone,
    contactId: ctx.contact?.id ?? null,
    phoneNumberId: number.id,
    language: call.language,
    plan: {
      purpose: call.purpose as OutboundPurpose,
      reason: call.reason,
      booking: ctx.booking
        ? { reference: ctx.booking.reference, service: ctx.booking.service, when }
        : null,
    },
  });
  const roomName = `ai-out-${conversation.conversationId}`;
  try {
    await deps.voice.dispatchAgent(roomName, {
      kind: "outbound",
      tenantId: call.tenantId,
      conversationId: conversation.conversationId,
      outboundCallId: call.id,
      callbackNumber: number.e164,
    });
    await deps.sip.dial({
      carrier,
      from: number.e164,
      to: call.phone,
      roomName,
      participantIdentity: "customer",
    });
  } catch (error) {
    deps.log.warn({ err: error, outboundCallId: call.id }, "outbound call couldn't be placed");
    await finishOutboundAttempt(db, call, {
      status: "no_answer",
      conversationId: conversation.conversationId,
    });
    return "no_answer: dial failed";
  }
  deps.log.info({ outboundCallId: call.id, purpose: call.purpose }, "outbound call placed");
  return "calling";
}

/** One pass over every business (businesses are listed from the auth table, no RLS). */
export async function dialDueCalls(
  deps: DialerDeps,
  now: Date = new Date(),
  /** Limit to these businesses (tests); by default every business. */
  only?: string[],
): Promise<number> {
  const orgs = await deps.db
    .select({ id: organization.id })
    .from(organization)
    .where(only ? inArray(organization.id, only) : undefined);
  let placed = 0;
  for (const { id } of orgs) {
    await reapStaleOutboundCalls(deps.db, id, now);
    for (const call of await claimDueOutboundCalls(deps.db, id, now)) {
      const result = await placeOutboundCall(deps, call, now).catch(async (error: unknown) => {
        deps.log.warn({ err: error, outboundCallId: call.id }, "outbound call failed");
        await finishOutboundAttempt(deps.db, call, { status: "failed", reason: "internal error" });
        return "failed";
      });
      if (result === "calling") placed++;
    }
  }
  return placed;
}

/** Starts the minute-by-minute dialler. Returns a stop function. */
export function startOutboundDialer(deps: DialerDeps): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void dialDueCalls(deps)
      .catch((error: unknown) => deps.log.warn({ err: error }, "outbound dialler pass failed"))
      .finally(() => {
        running = false;
      });
  }, DIAL_EVERY_MS);
  return () => clearInterval(timer);
}
