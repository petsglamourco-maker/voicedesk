import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../src/client";
import { consentEvents, contacts } from "../src/schema";
import { withTenant } from "../src/tenant-context";
import { connectTestDbs, createTestTenant, type TestDbs } from "../src/testing";

/** Consent history (security audit M18): every change recorded, nothing rewritable. */
let dbs: TestDbs;
let tenantId: string;
beforeAll(async () => {
  dbs = connectTestDbs();
  tenantId = await createTestTenant(dbs.app, "Consent Co");
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

describe("consent_events", () => {
  it("records each change of marketing consent, with its source", async () => {
    const [contact] = await withTenant(dbs.app, tenantId, async (tx) => {
      await tx.execute(sql`select set_config('app.consent_source', 'form', true)`);
      return tx
        .insert(contacts)
        .values({ tenantId, fullName: "Sam Patel", marketingConsent: true })
        .returning();
    });
    await withTenant(dbs.app, tenantId, (tx) =>
      tx.update(contacts).set({ fullName: "Sam P." }).where(eq(contacts.id, contact!.id)),
    ); // no consent change: no event
    await withTenant(dbs.app, tenantId, (tx) =>
      tx.update(contacts).set({ marketingConsent: false }).where(eq(contacts.id, contact!.id)),
    );
    const events = await withTenant(dbs.app, tenantId, (tx) =>
      tx
        .select()
        .from(consentEvents)
        .where(and(eq(consentEvents.tenantId, tenantId), eq(consentEvents.contactId, contact!.id)))
        .orderBy(consentEvents.id),
    );
    expect(events.map((e) => [e.granted, e.source])).toEqual([
      [true, "form"],
      [false, null],
    ]);

    // The app can't rewrite or delete the history.
    await expect(
      withTenant(dbs.app, tenantId, (tx) =>
        tx.update(consentEvents).set({ granted: true }).where(eq(consentEvents.id, events[1]!.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(dbs.app, tenantId, (tx) =>
        tx.delete(consentEvents).where(eq(consentEvents.id, events[0]!.id)),
      ),
    ).rejects.toThrow();
  });

  it("history tables stay append-only for the app role", async () => {
    for (const table of [
      "audit_log",
      "consent_events",
      "spend_events",
      "spend_alerts",
      "processed_messages",
      "department_moves",
    ]) {
      const rows = await dbs.owner.execute<{ u: boolean; d: boolean }>(
        sql`select has_table_privilege('voicedesk_app', ${table}, 'UPDATE') as u,
                   has_table_privilege('voicedesk_app', ${table}, 'DELETE') as d`,
      );
      expect(rows.rows[0], table).toEqual({ u: false, d: false });
    }
  });
});
