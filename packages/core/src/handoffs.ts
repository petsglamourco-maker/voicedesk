import { contacts, conversations, handoffs, withTenant, type Database } from "@voicedesk/db";
import { and, asc, eq, inArray } from "drizzle-orm";

/**
 * Phone calls handed from the assistant to a person at the VA console (Phase 5, ADR 0018).
 * Every status change is a conditional update, so two people answering at once, or an
 * answer racing the ring timeout, can only ever have one winner.
 */

export type HandoffRow = typeof handoffs.$inferSelect;
export type HandoffStatus = "waiting" | "answered" | "returned" | "missed" | "ended";

export async function createHandoff(
  db: Database,
  params: {
    tenantId: string;
    conversationId: string;
    roomName: string;
    reason: string | null;
    urgent: boolean;
  },
): Promise<HandoffRow> {
  const [row] = await withTenant(db, params.tenantId, (tx) =>
    tx
      .insert(handoffs)
      .values({ ...params, reason: params.reason?.slice(0, 200) ?? null })
      .returning(),
  );
  return row!;
}

export async function getHandoff(
  db: Database,
  tenantId: string,
  id: string,
): Promise<HandoffRow | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(handoffs)
      .where(and(eq(handoffs.id, id), eq(handoffs.tenantId, tenantId))),
  );
  return row ?? null;
}

/** Answers a waiting call. Null when someone else got there first or it stopped ringing. */
export async function claimHandoff(
  db: Database,
  tenantId: string,
  id: string,
  userId: string,
  now: Date = new Date(),
): Promise<HandoffRow | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .update(handoffs)
      .set({ status: "answered", answeredBy: userId, answeredAt: now })
      .where(
        and(eq(handoffs.id, id), eq(handoffs.tenantId, tenantId), eq(handoffs.status, "waiting")),
      )
      .returning(),
  );
  return row ?? null;
}

/**
 * Moves a handoff on, only from one of the expected statuses (and, when `by` is given, only
 * for the person who answered it). Null when the call had already moved on.
 */
export async function moveHandoff(
  db: Database,
  tenantId: string,
  id: string,
  from: HandoffStatus[],
  to: HandoffStatus,
  options: { by?: string; now?: Date } = {},
): Promise<HandoffRow | null> {
  const now = options.now ?? new Date();
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .update(handoffs)
      .set({ status: to, ...(to === "answered" || to === "waiting" ? {} : { endedAt: now }) })
      .where(
        and(
          eq(handoffs.id, id),
          eq(handoffs.tenantId, tenantId),
          inArray(handoffs.status, from),
          ...(options.by ? [eq(handoffs.answeredBy, options.by)] : []),
        ),
      )
      .returning(),
  );
  return row ?? null;
}

export interface WaitingCall {
  id: string;
  conversationId: string;
  reason: string | null;
  urgent: boolean;
  queuedAt: Date;
  callerPhone: string | null;
  callerName: string | null;
}

/** Calls ringing at the VA console for this business, oldest (and urgent) first. */
export async function waitingHandoffs(db: Database, tenantId: string): Promise<WaitingCall[]> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ handoff: handoffs, state: conversations.state, contactName: contacts.fullName })
      .from(handoffs)
      .innerJoin(conversations, eq(conversations.id, handoffs.conversationId))
      .leftJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(eq(handoffs.tenantId, tenantId), eq(handoffs.status, "waiting")))
      .orderBy(asc(handoffs.queuedAt)),
  );
  return rows
    .map(({ handoff, state, contactName }) => ({
      id: handoff.id,
      conversationId: handoff.conversationId,
      reason: handoff.reason,
      urgent: handoff.urgent,
      queuedAt: handoff.queuedAt,
      callerPhone: (state as { callerPhone?: string | null }).callerPhone ?? null,
      callerName: contactName,
    }))
    .sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

/** The call this person is on right now, if any. */
export async function activeHandoffFor(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<HandoffRow | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(handoffs)
      .where(
        and(
          eq(handoffs.tenantId, tenantId),
          eq(handoffs.answeredBy, userId),
          eq(handoffs.status, "answered"),
        ),
      ),
  );
  return row ?? null;
}
