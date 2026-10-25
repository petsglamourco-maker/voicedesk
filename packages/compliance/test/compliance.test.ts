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

  it("redacts at any depth, including message content (audit M13)", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = pino(loggerOptions("test", "info"), sink);
    log.warn(
      {
        job: { data: { form: { name: "Sam", email: "s@x.com", message: "my address is…" } } },
        reply: { text: "Your booking is at 10" },
        counts: { sms: 2 },
      },
      "processed",
    );
    const entry = JSON.parse(lines[0]!) as {
      job: { data: { form: Record<string, string> } };
      reply: unknown;
      counts: unknown;
    };
    expect(entry.job.data.form).toEqual({
      name: "[redacted]",
      email: "[redacted]",
      message: "[redacted]",
    });
    expect(entry.reply).toBe("[redacted]");
    expect(entry.counts).toEqual({ sms: 2 });
  });

  it("keeps errors useful but strips query parameters and personal data", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = pino(loggerOptions("test", "info"), sink);
    const err = new Error(
      'Failed query: select * from "user" where "email" = $1\nparams: sam@example.com',
    );
    log.error({ err, tenantId: "t1" }, "lookup failed");
    const entry = JSON.parse(lines[0]!) as {
      err: { message: string; stack: string; type: string };
    };
    expect(entry.err.type).toBe("Error");
    expect(entry.err.message).toContain("Failed query");
    expect(JSON.stringify(entry)).not.toContain("sam@example.com");
  });

  it("leaves class instances (e.g. requests) to their serializers", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    class FakeRequest {
      get url() {
        return "/api/x?token=secret";
      }
    }
    const options = loggerOptions("test", "info");
    const log = pino(
      {
        ...options,
        serializers: {
          ...options.serializers,
          req: (r: FakeRequest) => ({ path: r.url.split("?")[0] }),
        },
      },
      sink,
    );
    log.info({ req: new FakeRequest() }, "incoming");
    expect(JSON.parse(lines[0]!)).toMatchObject({ req: { path: "/api/x" } });
  });
});
