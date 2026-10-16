import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { COUNTRIES, getCountryConfig } from "../src/countries";
import { loggerOptions } from "../src/logger";
import { redactPii } from "../src/redact";

describe("country configs", () => {
  it("require AI disclosure everywhere", () => {
    for (const config of Object.values(COUNTRIES)) expect(config.aiDisclosure.required).toBe(true);
  });

  it("looks up case-insensitively and rejects unsupported countries", () => {
    expect(getCountryConfig("gb").emergencyNumbers).toContain("999");
    expect(() => getCountryConfig("XX")).toThrow(/not supported/);
  });
});

describe("redactPii", () => {
  it("redacts emails, phones and valid card numbers", () => {
    const out = redactPii(
      "Call me on +44 7700 900123 or 020 7946 0958, email jane.doe@example.co.uk, card 4242 4242 4242 4242",
    );
    expect(out).not.toMatch(/7700|7946|jane|4242/);
    expect(out).toContain("[email]");
    expect(out).toContain("[card]");
    expect(out).toContain("[phone]");
  });

  it("leaves ordinary text and short numbers alone", () => {
    expect(redactPii("Booking ref 4821 for 3 people at 10:30")).toBe(
      "Booking ref 4821 for 3 people at 10:30",
    );
  });
});

describe("logger", () => {
  it("redacts personal data fields", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = pino(loggerOptions("test", "info"), sink);
    log.info({ contact: { email: "a@b.com", phoneE164: "+447700900123" }, tenantId: "t1" }, "hi");
    const entry = JSON.parse(lines[0]!) as { contact: Record<string, string>; tenantId: string };
    expect(entry.contact).toEqual({ email: "[redacted]", phoneE164: "[redacted]" });
    expect(entry.tenantId).toBe("t1");
  });
});
