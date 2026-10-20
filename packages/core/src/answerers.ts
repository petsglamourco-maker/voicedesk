import {
  agentPresence,
  member,
  organization,
  user,
  vaAssignments,
  withPlatformAccess,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { recordAudit } from "./audit";

/**
 * People who answer handed-off calls (Phase 5, ADR 0018): VAs you assign across businesses
 * ("platform") and a business's own members who opt in ("business"). Both are rows in
 * `va_assignments`; a platform VA also gets a staff membership so normal tenant access
 * (RLS, permissions) applies.
 */

export const PRESENCE_STATUSES = ["available", "busy", "away", "offline"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** Without a heartbeat for this long, a console counts as offline. */
export const PRESENCE_TTL_MS = 60_000;

export class AnswererError extends Error {
  constructor(
    readonly code: "USER_NOT_FOUND" | "TENANT_NOT_FOUND" | "NOT_A_MEMBER",
    message: string,
  ) {
    super(message);
  }
}

export interface VaAssignmentView {
  tenantId: string;
  tenantName: string;
  userId: string;
  name: string;
  email: string;
  source: string;
}

/** Platform admin: every assignment, with names. */
export async function listVaAssignments(
  db: Database,
  actorUserId: string,
): Promise<VaAssignmentView[]> {
  return withPlatformAccess(db, { actorUserId, reason: "list VA assignments" }, (tx) =>
    tx
      .select({
        tenantId: vaAssignments.tenantId,
        tenantName: organization.name,
        userId: vaAssignments.userId,
        name: user.name,
        email: user.email,
        source: vaAssignments.source,
      })
      .from(vaAssignments)
      .innerJoin(user, eq(user.id, vaAssignments.userId))
      .innerJoin(organization, eq(organization.id, vaAssignments.tenantId))
      .orderBy(asc(user.name), asc(organization.name)),
  );
}

/** Platform admin: lets a user (by email) answer calls for a business. */
export async function assignVa(
  db: Database,
  actorUserId: string,
  params: { email: string; tenantId: string },
): Promise<{ userId: string; createdMembership: boolean }> {
  return withPlatformAccess(db, { actorUserId, reason: "assign VA" }, async (tx) => {
    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, params.email.trim().toLowerCase()));
    if (!target) {
      throw new AnswererError(
        "USER_NOT_FOUND",
        "No account with that email. Ask them to sign up first.",
      );
    }
    const [org] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, params.tenantId));
    if (!org) throw new AnswererError("TENANT_NOT_FOUND", "Business not found");
    const [existing] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, target.id), eq(member.organizationId, params.tenantId)));
    if (!existing) {
      await tx.insert(member).values({
        organizationId: params.tenantId,
        userId: target.id,
        role: "staff",
        createdAt: new Date(),
      });
    }
    await tx
      .insert(vaAssignments)
      .values({
        tenantId: params.tenantId,
        userId: target.id,
        source: "platform",
        createdMembership: !existing,
      })
      .onConflictDoUpdate({
        target: [vaAssignments.tenantId, vaAssignments.userId],
        set: { source: "platform" },
      });
    await recordAudit(tx, {
      tenantId: params.tenantId,
      actorType: "user",
      actorUserId,
      action: "va.assigned",
      targetType: "user",
      targetId: target.id,
    });
    return { userId: target.id, createdMembership: !existing };
  });
}

/** Platform admin: removes a VA from a business (and the membership the assignment made). */
export async function removeVa(
  db: Database,
  actorUserId: string,
  params: { tenantId: string; userId: string },
): Promise<boolean> {
  return withPlatformAccess(db, { actorUserId, reason: "remove VA" }, async (tx) => {
    const [row] = await tx
      .delete(vaAssignments)
      .where(
        and(eq(vaAssignments.tenantId, params.tenantId), eq(vaAssignments.userId, params.userId)),
      )
      .returning();
    if (!row) return false;
    if (row.createdMembership) {
      await tx
        .delete(member)
        .where(
          and(
            eq(member.organizationId, params.tenantId),
            eq(member.userId, params.userId),
            eq(member.role, "staff"),
          ),
        );
    }
    await recordAudit(tx, {
      tenantId: params.tenantId,
      actorType: "user",
      actorUserId,
      action: "va.removed",
      targetType: "user",
      targetId: params.userId,
    });
    return true;
  });
}

/** Who answers calls for this business, and how they got there. */
export async function listAnswerers(
  db: Database,
  tenantId: string,
): Promise<Array<{ userId: string; source: string }>> {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select({ userId: vaAssignments.userId, source: vaAssignments.source })
      .from(vaAssignments)
      .where(eq(vaAssignments.tenantId, tenantId)),
  );
}

/**
 * A business member opts in or out of answering calls. Platform VAs are managed in
 * Platform admin and aren't changed here.
 */
export async function setAnswersCalls(
  db: Database,
  tenantId: string,
  actorUserId: string,
  userId: string,
  on: boolean,
): Promise<void> {
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, tenantId)));
  if (!membership) throw new AnswererError("NOT_A_MEMBER", "Not a member of this business");
  await withTenant(db, tenantId, async (tx) => {
    if (on) {
      await tx
        .insert(vaAssignments)
        .values({ tenantId, userId, source: "business" })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(vaAssignments)
        .where(
          and(
            eq(vaAssignments.tenantId, tenantId),
            eq(vaAssignments.userId, userId),
            eq(vaAssignments.source, "business"),
          ),
        );
    }
    await recordAudit(tx, {
      tenantId,
      actorType: "user",
      actorUserId,
      action: on ? "answerer.added" : "answerer.removed",
      targetType: "user",
      targetId: userId,
    });
  });
}

/** Businesses this user answers calls for (their memberships, filtered by assignment). */
export async function answererTenants(
  db: Database,
  userId: string,
): Promise<Array<{ tenantId: string; name: string; source: string }>> {
  const memberships = await db
    .select({ tenantId: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));
  const out: Array<{ tenantId: string; name: string; source: string }> = [];
  for (const m of memberships) {
    const [row] = await withTenant(db, m.tenantId, (tx) =>
      tx
        .select({ source: vaAssignments.source })
        .from(vaAssignments)
        .where(and(eq(vaAssignments.tenantId, m.tenantId), eq(vaAssignments.userId, userId))),
    );
    if (row) out.push({ ...m, source: row.source });
  }
  return out;
}

export async function setPresence(
  db: Database,
  userId: string,
  status: PresenceStatus,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(agentPresence)
    .values({ userId, status, lastSeenAt: now })
    .onConflictDoUpdate({ target: agentPresence.userId, set: { status, lastSeenAt: now } });
}

/** The user's status, treating a stale heartbeat as offline. */
export async function getPresence(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<PresenceStatus> {
  const [row] = await db.select().from(agentPresence).where(eq(agentPresence.userId, userId));
  if (!row || now.getTime() - row.lastSeenAt.getTime() > PRESENCE_TTL_MS) return "offline";
  return row.status as PresenceStatus;
}

/** People who could take a call for this business right now. */
export async function availableAnswerers(
  db: Database,
  tenantId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const ids = (await listAnswerers(db, tenantId)).map((a) => a.userId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ userId: agentPresence.userId })
    .from(agentPresence)
    .where(
      and(
        inArray(agentPresence.userId, ids),
        eq(agentPresence.status, "available"),
        gt(agentPresence.lastSeenAt, new Date(now.getTime() - PRESENCE_TTL_MS)),
      ),
    );
  return rows.map((r) => r.userId);
}
