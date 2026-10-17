import { auditLog, businessProfiles, withTenant, type Database } from "@voicedesk/db";
import { and, desc, eq, max } from "drizzle-orm";
import { businessProfileSchema, normalizeProfile, type BusinessProfile } from "./profile";

export interface ProfileVersion {
  version: number;
  status: "draft" | "approved" | "superseded";
  data: BusinessProfile;
  generatedBy: string;
  createdAt: Date;
  approvedAt: Date | null;
}

function toVersion(row: typeof businessProfiles.$inferSelect): ProfileVersion {
  return {
    version: row.version,
    status: row.status,
    data: normalizeProfile(row.data),
    generatedBy: row.generatedBy,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
  };
}

/** The approved profile plus the newest draft (if it is newer than the approved one). */
export async function getProfiles(
  db: Database,
  tenantId: string,
): Promise<{ approved: ProfileVersion | null; draft: ProfileVersion | null }> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.tenantId, tenantId))
      .orderBy(desc(businessProfiles.version))
      .limit(20),
  );
  const approvedRow = rows.find((r) => r.status === "approved");
  const draftRow = rows.find(
    (r) => r.status === "draft" && (!approvedRow || r.version > approvedRow.version),
  );
  return {
    approved: approvedRow ? toVersion(approvedRow) : null,
    draft: draftRow ? toVersion(draftRow) : null,
  };
}

export async function getApprovedProfile(
  db: Database,
  tenantId: string,
): Promise<BusinessProfile | null> {
  return (await getProfiles(db, tenantId)).approved?.data ?? null;
}

/** Saves edits as the current draft (updating it, or starting a new draft version). */
export async function saveDraft(
  db: Database,
  tenantId: string,
  data: BusinessProfile,
  userId: string,
): Promise<number> {
  const profile = businessProfileSchema.parse(data);
  return withTenant(db, tenantId, async (tx) => {
    const [latest] = await tx
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.tenantId, tenantId))
      .orderBy(desc(businessProfiles.version))
      .limit(1);
    if (latest?.status === "draft") {
      await tx
        .update(businessProfiles)
        .set({ data: profile })
        .where(eq(businessProfiles.id, latest.id));
      return latest.version;
    }
    const [row] = await tx
      .select({ v: max(businessProfiles.version) })
      .from(businessProfiles)
      .where(eq(businessProfiles.tenantId, tenantId));
    const next = (row?.v ?? 0) + 1;
    await tx.insert(businessProfiles).values({
      tenantId,
      version: next,
      status: "draft",
      data: profile,
      generatedBy: "manual",
      createdBy: userId,
    });
    return next;
  });
}

/** Makes a draft version the live profile; the previous approved version is superseded. */
export async function approveVersion(
  db: Database,
  tenantId: string,
  version: number,
  userId: string,
): Promise<boolean> {
  return withTenant(db, tenantId, async (tx) => {
    const [target] = await tx
      .select()
      .from(businessProfiles)
      .where(
        and(
          eq(businessProfiles.tenantId, tenantId),
          eq(businessProfiles.version, version),
          eq(businessProfiles.status, "draft"),
        ),
      );
    if (!target) return false;
    await tx
      .update(businessProfiles)
      .set({ status: "superseded" })
      .where(and(eq(businessProfiles.tenantId, tenantId), eq(businessProfiles.status, "approved")));
    await tx
      .update(businessProfiles)
      .set({ status: "approved", approvedBy: userId, approvedAt: new Date() })
      .where(eq(businessProfiles.id, target.id));
    await tx.insert(auditLog).values({
      tenantId,
      actorType: "user",
      actorUserId: userId,
      action: "profile.approved",
      targetType: "business_profile",
      targetId: String(version),
    });
    return true;
  });
}
