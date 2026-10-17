import { bookings, contacts, withTenant, type Database } from "@voicedesk/db";
import { and, asc, eq, gt } from "drizzle-orm";

/**
 * Contacts the assistant works with (Phase 3): caller recognition and linking new records to
 * the person they're about.
 */

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

/**
 * Finds the contact with this phone number, or creates one (source "assistant"). Existing
 * details are only filled in, never overwritten: the business may have corrected them.
 */
export async function upsertContactByPhone(
  t: Tx,
  tenantId: string,
  person: { phone: string | null | undefined; name?: string | null; email?: string | null },
): Promise<string | null> {
  if (!person.phone) return null;
  const [existing] = await t
    .select()
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phoneE164, person.phone)));
  if (existing) {
    const fill: Partial<typeof contacts.$inferInsert> = {};
    if (!existing.fullName && person.name) fill.fullName = person.name;
    if (!existing.email && person.email) fill.email = person.email;
    if (Object.keys(fill).length) {
      await t
        .update(contacts)
        .set({ ...fill, updatedAt: new Date() })
        .where(eq(contacts.id, existing.id));
    }
    return existing.id;
  }
  const [row] = await t
    .insert(contacts)
    .values({
      tenantId,
      phoneE164: person.phone,
      fullName: person.name ?? null,
      email: person.email ?? null,
      source: "assistant",
    })
    .onConflictDoNothing()
    .returning({ id: contacts.id });
  if (row) return row.id;
  // Lost a race with another conversation creating the same contact.
  const [again] = await t
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phoneE164, person.phone)));
  return again?.id ?? null;
}

export interface KnownCaller {
  contactId: string;
  name: string | null;
  upcoming: Array<{ reference: string; service: string; startsAt: string }>;
}

/** A returning caller, recognised by their number (the phone network's caller ID). */
export async function recogniseCaller(
  db: Database,
  tenantId: string,
  phone: string | null,
): Promise<KnownCaller | null> {
  if (!phone) return null;
  return withTenant(db, tenantId, async (t) => {
    const [contact] = await t
      .select({ id: contacts.id, name: contacts.fullName })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phoneE164, phone)));
    if (!contact) return null;
    const upcoming = await t
      .select({
        reference: bookings.reference,
        service: bookings.service,
        startsAt: bookings.startsAt,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.customerPhone, phone),
          eq(bookings.status, "confirmed"),
          gt(bookings.startsAt, new Date()),
        ),
      )
      .orderBy(asc(bookings.startsAt))
      .limit(3);
    return {
      contactId: contact.id,
      name: contact.name,
      upcoming: upcoming.map((b) => ({ ...b, startsAt: b.startsAt.toISOString() })),
    };
  });
}
