import type { SupportedFileType } from "./extract";

/**
 * Upload safety (security audit M5): the file's bytes must match its type (never trust the
 * name or the browser's MIME type), and parsing has limits so a crafted file can't exhaust
 * the server (huge page counts, zip bombs, endless rows).
 */
export const MAX_PDF_PAGES = 500;
/** Total uncompressed size of a DOCX (a zip) and its number of parts. */
export const MAX_DOCX_UNCOMPRESSED = 100 * 1024 * 1024;
export const MAX_DOCX_ENTRIES = 5000;
export const MAX_CSV_ROWS = 50_000;
/** Text kept from one file (about 1,000 pages). */
export const MAX_TEXT_CHARS = 2_000_000;
export const EXTRACT_TIMEOUT_MS = 60_000;

export const CONTENT_TYPES: Record<SupportedFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

export class FileRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileRejectedError";
  }
}

const ascii = (data: Uint8Array, from: number, length: number) =>
  String.fromCharCode(...data.subarray(from, from + length));

function indexOf(data: Uint8Array, needle: string, limit = data.length): number {
  const bytes = [...needle].map((c) => c.charCodeAt(0));
  const end = Math.min(limit, data.length) - bytes.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < bytes.length; j++) if (data[i + j] !== bytes[j]) continue outer;
    return i;
  }
  return -1;
}

/** Whether the bytes really are the claimed type. */
export function contentMatches(data: Uint8Array, type: SupportedFileType): boolean {
  switch (type) {
    case "pdf":
      // "%PDF-" must appear within the first kilobyte (the spec allows leading junk).
      return indexOf(data, "%PDF-", 1024) !== -1;
    case "docx":
      // A zip ("PK\x03\x04") whose parts include the Word document.
      return ascii(data, 0, 4) === "PK\x03\x04" && indexOf(data, "word/") !== -1;
    case "csv":
    case "txt": {
      const head = data.subarray(0, 64 * 1024);
      if (head.includes(0)) return false; // binary
      if (ascii(head, 0, 4) === "PK\x03\x04" || ascii(head, 0, 5) === "%PDF-") return false;
      if (ascii(head, 0, 2) === "MZ") return false; // Windows programs
      try {
        // Valid UTF-8 (ignoring a sequence cut off at the 64 KB boundary).
        new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, head.length - 4));
        return true;
      } catch {
        return false;
      }
    }
  }
}

/**
 * Reads a zip's central directory: number of parts and their total uncompressed size, before
 * anything is unpacked. Throws for anything that doesn't look like a sane zip.
 */
export function zipSummary(data: Uint8Array): { entries: number; uncompressed: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // End of central directory: signature 0x06054b50, within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new FileRejectedError("This Word file looks damaged.");
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  let uncompressed = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > data.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new FileRejectedError("This Word file looks damaged.");
    }
    uncompressed += view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, uncompressed };
}

export function checkDocxLimits(data: Uint8Array): void {
  const { entries, uncompressed } = zipSummary(data);
  if (entries > MAX_DOCX_ENTRIES || uncompressed > MAX_DOCX_UNCOMPRESSED) {
    throw new FileRejectedError(
      "This Word file is too large once unpacked. Split it into smaller documents.",
    );
  }
}

export async function withTimeout<T>(work: Promise<T>, ms = EXTRACT_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new FileRejectedError("Reading this file took too long.")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
