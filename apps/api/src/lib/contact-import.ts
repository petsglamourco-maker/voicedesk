import { normalisePhone } from "@voicedesk/agent-brain";
import { parseYes, type ContactField } from "@voicedesk/core";

export const MAX_IMPORT_ROWS = 5000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ImportRow {
  line: number;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  marketingConsent: boolean;
}

export interface ImportPlan {
  rows: ImportRow[];
  errors: Array<{ line: number; reason: string }>;
  duplicatesInFile: number;
}

/**
 * Validates and normalises CSV rows (header row excluded) for import: phones to E.164 with
 * the business's country, emails checked, duplicates within the file merged (phone, then
 * email). Every rejected row is reported with its line number.
 */
export function planImport(
  table: string[][],
  mapping: Partial<Record<ContactField, number>>,
  countryCode: string,
): ImportPlan {
  const get = (row: string[], field: ContactField) => {
    const index = mapping[field];
    const value = index === undefined ? "" : (row[index] ?? "").trim();
    return value === "" ? null : value;
  };
  const rows: ImportRow[] = [];
  const errors: ImportPlan["errors"] = [];
  const seen = new Map<string, ImportRow>();
  let duplicatesInFile = 0;
  table.forEach((raw, i) => {
    const line = i + 2; // 1-based, after the header row
    const rawPhone = get(raw, "phone");
    const phone = rawPhone ? normalisePhone(rawPhone, countryCode) : null;
    if (rawPhone && !phone) {
      errors.push({ line, reason: `Phone number not recognised: ${rawPhone.slice(0, 30)}` });
      return;
    }
    const email = get(raw, "email")?.toLowerCase() ?? null;
    if (email && !EMAIL.test(email)) {
      errors.push({ line, reason: `Email address not valid: ${email.slice(0, 60)}` });
      return;
    }
    const fullName = get(raw, "fullName")?.slice(0, 200) ?? null;
    if (!phone && !email) {
      errors.push({ line, reason: "Needs a phone number or an email address" });
      return;
    }
    const row: ImportRow = {
      line,
      fullName,
      phone,
      email,
      notes: get(raw, "notes")?.slice(0, 2000) ?? null,
      marketingConsent: parseYes(get(raw, "marketingConsent") ?? undefined),
    };
    const key = phone ?? `email:${email}`;
    const earlier = seen.get(key) ?? (email ? seen.get(`email:${email}`) : undefined);
    if (earlier) {
      duplicatesInFile++;
      earlier.fullName ??= row.fullName;
      earlier.email ??= row.email;
      earlier.notes ??= row.notes;
      earlier.marketingConsent ||= row.marketingConsent;
      return;
    }
    seen.set(key, row);
    if (email) seen.set(`email:${email}`, row);
    rows.push(row);
  });
  return { rows, errors, duplicatesInFile };
}
