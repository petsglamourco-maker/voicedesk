import { describe, expect, it } from "vitest";
import { extractFile } from "../src/extract";
import { contentMatches, zipSummary } from "../src/file-safety";

/** Upload safety (security audit M5). */
const bytes = (s: string) => new TextEncoder().encode(s);

/** A minimal zip: one stored entry, with sizes we choose for the central directory. */
function fakeZip(name: string, claimedSize: number, entries = 1): Uint8Array {
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  local.set(bytes(name), 30);
  lv.setUint16(26, name.length, true);
  const centrals: Uint8Array[] = [];
  for (let i = 0; i < entries; i++) {
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(24, claimedSize, true);
    cv.setUint16(28, name.length, true);
    c.set(bytes(name), 46);
    centrals.push(c);
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries, true);
  ev.setUint16(10, entries, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + centralSize + eocd.length);
  out.set(local, 0);
  let at = local.length;
  for (const c of centrals) {
    out.set(c, at);
    at += c.length;
  }
  out.set(eocd, at);
  return out;
}

describe("file contents must match the type", () => {
  it("checks PDF, DOCX and text signatures", () => {
    expect(contentMatches(bytes("%PDF-1.7\n..."), "pdf")).toBe(true);
    expect(contentMatches(bytes("MZ\x90\x00 a program"), "pdf")).toBe(false);
    expect(contentMatches(fakeZip("word/document.xml", 100), "docx")).toBe(true);
    expect(contentMatches(fakeZip("xl/workbook.xml", 100), "docx")).toBe(false);
    expect(contentMatches(bytes("name,phone\nSam,0770"), "csv")).toBe(true);
    expect(contentMatches(bytes("Opening hours: 9 to 5. Café ☕"), "txt")).toBe(true);
    expect(contentMatches(new Uint8Array([0x4d, 0x5a, 0, 1, 2]), "txt")).toBe(false);
    expect(
      contentMatches(new Uint8Array([0xff, 0xfe, 0xfd, 0x41, 0x42, 0x43, 0x44, 0x45]), "txt"),
    ).toBe(false);
    expect(contentMatches(bytes("%PDF-1.4 renamed"), "txt")).toBe(false);
  });

  it("refuses a renamed file when extracting", async () => {
    await expect(extractFile(bytes("MZ not a pdf"), "pdf")).rejects.toThrow(/isn't a valid PDF/);
  });
});

describe("zip bombs", () => {
  it("reads sizes from the zip's directory before unpacking", () => {
    expect(zipSummary(fakeZip("word/document.xml", 1234))).toEqual({
      entries: 1,
      uncompressed: 1234,
    });
  });

  it("refuses a Word file that would unpack to more than 100 MB", async () => {
    const bomb = fakeZip("word/document.xml", 0xfffffff0);
    await expect(extractFile(bomb, "docx")).rejects.toThrow(/too large once unpacked/);
  });

  it("refuses a damaged zip", async () => {
    const broken = new Uint8Array([0x50, 0x4b, 3, 4, ...bytes("word/ nothing else")]);
    await expect(extractFile(broken, "docx")).rejects.toThrow(/damaged/);
  });
});
