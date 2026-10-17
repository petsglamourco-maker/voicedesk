import { describe, expect, it } from "vitest";
import { guessMapping, parseCsv, parseYes } from "../src/csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded newlines and CRLF", () => {
    const csv =
      'Name,Phone,Notes\r\n"Patel, Sam",07700 900123,"Likes ""early"" slots\nNo Fridays"\r\nJo,,\r\n';
    expect(parseCsv(csv)).toEqual([
      ["Name", "Phone", "Notes"],
      ["Patel, Sam", "07700 900123", 'Likes "early" slots\nNo Fridays'],
      ["Jo", "", ""],
    ]);
  });

  it("detects semicolons and tabs, strips the BOM and blank lines", () => {
    expect(parseCsv("\uFEFFNom;Téléphone\n\nLéa;0612345678\n")).toEqual([
      ["Nom", "Téléphone"],
      ["Léa", "0612345678"],
    ]);
    expect(parseCsv("Name\tPhone\nSam\t123")).toEqual([
      ["Name", "Phone"],
      ["Sam", "123"],
    ]);
  });
});

describe("guessMapping", () => {
  it("maps common headers in several languages", () => {
    expect(guessMapping(["Full name", "Mobile", "E-mail", "Notes", "Marketing opt-in"])).toEqual({
      fullName: 0,
      phone: 1,
      email: 2,
      notes: 3,
      marketingConsent: 4,
    });
    expect(guessMapping(["Nombre", "Teléfono", "Correo"])).toMatchObject({
      fullName: 0,
      email: 2,
    });
  });
});

describe("parseYes", () => {
  it.each([
    ["yes", true],
    ["TRUE", true],
    ["1", true],
    ["oui", true],
    ["no", false],
    ["", false],
    [undefined, false],
  ])("%s → %s", (v, expected) => expect(parseYes(v)).toBe(expected));
});
