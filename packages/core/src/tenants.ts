import { SUPPORTED_COUNTRY_CODES, type SupportedLanguage } from "@voicedesk/compliance";
import {
  type Database,
  member,
  organization,
  subscriptions,
  tenants,
  withTenant,
} from "@voicedesk/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { trialValues } from "./plans";
import { recordAudit } from "./audit";
import { BUSINESS_ROLES, type BusinessRole } from "./permissions";

export const SUPPORTED_LANGUAGES = [
  "en",
  "es",
  "zh",
  "fr",
  "ar",
  "de",
] as const satisfies readonly SupportedLanguage[];

const TIME_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

export function isValidTimeZone(tz: string): boolean {
  return TIME_ZONES.has(tz) || tz === "UTC";
}

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(120),
  countryCode: z
    .string()
    .transform((c) => c.toUpperCase())
    .refine((c) => SUPPORTED_COUNTRY_CODES.includes(c), "Country not supported yet"),
  timezone: z.string().refine(isValidTimeZone, "Unknown time zone"),
  defaultLanguage: z.enum(SUPPORTED_LANGUAGES),
});
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;

export type Tenant = typeof tenants.$inferSelect;

/**
 * Creates the tenant business profile for an organization that was just created via auth.
 * The caller must be the organization's creator (owner).
 */
export async function createTenantProfile(
  db: Database,
  params: { tenantId: string; actorUserId: string; input: CreateBusinessInput; ip?: string | null },
): Promise<Tenant> {
  return withTenant(db, params.tenantId, async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({ id: params.tenantId, ...params.input })
      .returning();
    // Every new business starts on the free trial (ADR 0023).
    await tx.insert(subscriptions).values(trialValues(params.tenantId));
    await recordAudit(tx, {
      tenantId: params.tenantId,
      actorType: "user",
      actorUserId: params.actorUserId,
      action: "tenant.created",
      targetType: "tenant",
      targetId: params.tenantId,
      metadata: { countryCode: params.input.countryCode },
      ipAddress: params.ip ?? null,
    });
    return tenant!;
  });
}

export async function getTenant(db: Database, tenantId: string): Promise<Tenant | null> {
  const [tenant] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(tenants).where(eq(tenants.id, tenantId)),
  );
  return tenant ?? null;
}

/**
 * Returns the user's role in a tenant, or null if they are not a member. This is the
 * authorization check that must pass before any withTenant() call for that user.
 */
export async function getMembershipRole(
  db: Database,
  userId: string,
  tenantId: string,
): Promise<BusinessRole | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, tenantId)));
  // A user may hold several comma-separated roles; take the most privileged known one.
  const roles = (row?.role ?? "").split(",").map((r) => r.trim());
  return BUSINESS_ROLES.find((candidate) => roles.includes(candidate)) ?? null;
}

export interface UserTenantSummary {
  tenantId: string;
  name: string;
  slug: string;
  role: string;
}

/** Businesses the user belongs to (from auth membership, not RLS-protected tenant data). */
export async function listUserTenants(db: Database, userId: string): Promise<UserTenantSummary[]> {
  return db
    .select({
      tenantId: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));
}
