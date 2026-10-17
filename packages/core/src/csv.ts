/**
 * Minimal RFC 4180 CSV parser for contact imports: quoted fields, escaped quotes ("") and
 * line breaks inside quotes; comma, semicolon or tab delimiters (Excel in many European
 * locales saves with semicolons). No dependency, because imports are small (≤ 5,000 rows).
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, ""); // Excel's UTF-8 byte-order mark
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ""));
}

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? undefined : text.search(/\r?\n/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts[0]![0] : ",";
}

export const CONTACT_FIELDS = ["fullName", "phone", "email", "notes", "marketingConsent"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

const GUESSES: Record<ContactField, RegExp> = {
  fullName: /^(full ?name|name|customer|client|contact|nombre|nom|vorname|姓名|الاسم)$/i,
  phone: /(phone|mobile|tel|cell|número|numero|téléphone|telefon|电话|手机|هاتف)/i,
  email: /(e-?mail|correo|courriel|邮箱|البريد)/i,
  notes: /(note|comment|remark|notas|bemerkung|备注|ملاحظات)/i,
  marketingConsent: /(consent|opt.?in|marketing|newsletter)/i,
};

/** Column index per field, guessed from the header row (the business can change it). */
export function guessMapping(headers: string[]): Partial<Record<ContactField, number>> {
  const mapping: Partial<Record<ContactField, number>> = {};
  for (const field of CONTACT_FIELDS) {
    const index = headers.findIndex(
      (h, i) => GUESSES[field].test(h.trim()) && !Object.values(mapping).includes(i),
    );
    if (index !== -1) mapping[field] = index;
  }
  return mapping;
}

/** "yes", "true", "1", "y", "x", "oui", "sí", "ja" → true. */
export function parseYes(value: string | undefined): boolean {
  return /^(y|yes|true|1|x|oui|si|sí|ja|是|نعم)$/i.test((value ?? "").trim());
}
