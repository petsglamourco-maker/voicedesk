import { auditLog, type Tx } from "@voicedesk/db";

export interface AuditEntry {
  tenantId: string | null;
  actorType: "user" | "platform_owner" | "ai" | "system";
  actorUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Must not contain personal data beyond ids. */
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/** Appends an audit entry inside the caller's tenant (or platform) transaction. */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entry.tenantId,
    actorType: entry.actorType,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
    ipAddress: entry.ipAddress ?? null,
  });
}
