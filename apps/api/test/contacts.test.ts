import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planImport } from "../src/lib/contact-import";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;

beforeAll(async () => {
  h = await createHarness();
  owner = await createOwnerWithTenant(h, "Contacts API Co");
});
afterAll(() => h.close());

const headers = (cookie = owner.cookie) => ({ cookie, origin: ORIGIN });
const base = () => `/api/tenants/${owner.tenantId}/contacts`;

interface ContactView {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  marketingConsent: boolean;
  source: string;
}

const CSV = [
  "Full name,Mobile,E-mail,Notes,Marketing",
  "Sam Patel,07700 900123,SAM@example.com,Prefers mornings,yes",
  '"Shah, Priya",+44 7700 900124,,,no',
  "Sam P,07700900123,,Second row for Sam,", // duplicate phone in the file
  "Bad Number,12,,,",
  "No Contact,,,,",
  "Bad Email,,not-an-email,,",
].join("\n");

describe("contacts API", () => {
  it("previews a CSV with a suggested mapping", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `${base()}/import/preview`,
      headers: headers(),
      payload: { csv: CSV },
    });
    expect(res.json()).toMatchObject({
      headers: ["Full name", "Mobile", "E-mail", "Notes", "Marketing"],
      rowCount: 6,
      mapping: { fullName: 0, phone: 1, email: 2, notes: 3, marketingConsent: 4 },
    });
  });

  it("imports, normalises, de-duplicates and reports bad rows", async () => {
    const mapping = { fullName: 0, phone: 1, email: 2, notes: 3, marketingConsent: 4 };
    const res = await h.app.inject({
      method: "POST",
      url: `${base()}/import`,
      headers: headers(),
      payload: { csv: CSV, mapping },
    });
    expect(res.json()).toMatchObject({
      created: 2,
      updated: 0,
      duplicatesInFile: 1,
      errorCount: 3,
    });
    expect(res.json<{ errors: Array<{ line: number }> }>().errors.map((e) => e.line)).toEqual([
      5, 6, 7,
    ]);

    const list = await h.app.inject({
      method: "GET",
      url: `${base()}?q=patel`,
      headers: headers(),
    });
    const sam = list.json<{ contacts: ContactView[] }>().contacts[0]!;
    expect(sam).toMatchObject({
      fullName: "Sam Patel",
      phone: "+447700900123",
      email: "sam@example.com",
      notes: "Prefers mornings",
      marketingConsent: true,
      source: "import",
    });

    // Re-importing updates rather than duplicating, and never withdraws consent.
    const again = await h.app.inject({
      method: "POST",
      url: `${base()}/import`,
      headers: headers(),
      payload: {
        csv: "Name,Phone,Marketing\nSam Patel,07700 900123,no",
        mapping: { fullName: 0, phone: 1, marketingConsent: 2 },
      },
    });
    expect(again.json()).toMatchObject({ created: 0, updated: 1 });
    const bySearch = await h.app.inject({
      method: "GET",
      url: `${base()}?q=900123`,
      headers: headers(),
    });
    expect(bySearch.json<{ contacts: ContactView[]; total: number }>()).toMatchObject({
      total: 1,
      contacts: [{ marketingConsent: true }],
    });
  });

  it("adds, edits and deletes a contact; duplicate numbers are refused", async () => {
    const created = await h.app.inject({
      method: "POST",
      url: base(),
      headers: headers(),
      payload: { fullName: "Jo Bloggs", phone: "07700 900555" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<ContactView>().id;
    const dup = await h.app.inject({
      method: "POST",
      url: base(),
      headers: headers(),
      payload: { fullName: "Other", phone: "+447700900555" },
    });
    expect(dup.statusCode).toBe(409);
    const edited = await h.app.inject({
      method: "PATCH",
      url: `${base()}/${id}`,
      headers: headers(),
      payload: { notes: "VIP", email: "jo@example.com" },
    });
    expect(edited.json()).toMatchObject({ notes: "VIP", email: "jo@example.com" });
    const detail = await h.app.inject({
      method: "GET",
      url: `${base()}/${id}`,
      headers: headers(),
    });
    expect(detail.json()).toMatchObject({
      contact: { fullName: "Jo Bloggs" },
      bookings: [],
      tickets: [],
    });
    const del = await h.app.inject({
      method: "DELETE",
      url: `${base()}/${id}`,
      headers: headers(),
    });
    expect(del.statusCode).toBe(204);
    const gone = await h.app.inject({ method: "GET", url: `${base()}/${id}`, headers: headers() });
    expect(gone.statusCode).toBe(404);
  });

  it("keeps each business's contacts private", async () => {
    const other = await createOwnerWithTenant(h, "Other Contacts Co");
    const res = await h.app.inject({ method: "GET", url: base(), headers: headers(other.cookie) });
    expect(res.statusCode).toBe(404);
    const theirs = await h.app.inject({
      method: "GET",
      url: `/api/tenants/${other.tenantId}/contacts?q=patel`,
      headers: headers(other.cookie),
    });
    expect(theirs.json<{ total: number }>().total).toBe(0);
  });
});

describe("planImport", () => {
  it("handles 5,000 rows quickly", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [
      `Person ${i}`,
      `07700 ${String(900000 + i).padStart(6, "0")}`,
    ]);
    const started = Date.now();
    const plan = planImport(rows, { fullName: 0, phone: 1 }, "GB");
    expect(plan.rows).toHaveLength(5000);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
