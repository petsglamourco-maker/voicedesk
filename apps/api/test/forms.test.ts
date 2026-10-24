import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flattenFields, mapFields } from "../src/routes/forms";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

let h: TestHarness;
let biz: Awaited<ReturnType<typeof createOwnerWithTenant>>;

beforeAll(async () => {
  h = await createHarness();
  biz = await createOwnerWithTenant(h, "Forms Co");
});
afterAll(() => h.close());

const headers = () => ({ cookie: biz.cookie, origin: ORIGIN });
const settingsUrl = () => `/api/tenants/${biz.tenantId}/forms`;

interface FormView {
  key: string;
  enabled: boolean;
  hostedUrl: string;
  webhookPath: string;
}

async function enable(fieldMap: Record<string, string> = {}) {
  const res = await h.app.inject({
    method: "PUT",
    url: settingsUrl(),
    headers: headers(),
    payload: { enabled: true, title: "Ask us anything", intro: "", fieldMap },
  });
  expect(res.statusCode).toBe(200);
  return res.json<FormView>();
}

const hosted = (over: Record<string, unknown> = {}) => ({
  name: "Sam Patel",
  email: "sam@example.com",
  phone: "07700 900123",
  message: "Do you do evening appointments?",
  consent: true,
  marketing: false,
  website: "",
  elapsedMs: 8000,
  ...over,
});

describe("field mapping", () => {
  it("guesses common field names and keeps the rest as extra details", () => {
    const fields = flattenFields({
      name: "Sam",
      data: { "Email Address": "SAM@example.com", Mobile: "07700900123", Comments: "Hi" },
      service: "Cleaning",
      nested: { deep: { ignored: "x" } },
    });
    expect(mapFields(fields)).toEqual({
      name: "Sam",
      email: "SAM@example.com",
      phone: "07700900123",
      message: "Hi",
      extra: { service: "Cleaning" },
      contactConsent: true,
      marketingConsent: false,
    });
  });

  it("uses the configured mapping, and an unticked consent box means no reply", () => {
    const mapped = mapFields(
      { q1: "Alex", q2: "not-an-email", q3: "Hello", agree: "no" },
      { name: "q1", email: "q2", message: "q3", consent: "agree" },
    );
    expect(mapped).toMatchObject({ name: "Alex", email: null, message: "Hello" });
    expect(mapped.contactConsent).toBe(false);
  });
});

describe("form capture", () => {
  it("is off until switched on, then queues hosted submissions from our own site", async () => {
    const off = await h.app.inject({ method: "GET", url: settingsUrl(), headers: headers() });
    const { key } = off.json<FormView>();
    const closed = await h.app.inject({ method: "GET", url: `/api/public/forms/${key}` });
    expect(closed.statusCode).toBe(404);

    const view = await enable();
    expect(view.hostedUrl).toMatch(new RegExp(`/f/${key}$`));
    const info = await h.app.inject({ method: "GET", url: `/api/public/forms/${key}` });
    expect(info.json()).toEqual({
      businessName: "Forms Co",
      title: "Ask us anything",
      intro: null,
      siteKey: null,
    });

    const before = h.jobs.channels.length;
    const sent = await h.app.inject({
      method: "POST",
      url: `/api/public/forms/${key}`,
      headers: { origin: ORIGIN },
      payload: hosted(),
    });
    expect(sent.statusCode).toBe(202);
    expect(h.jobs.channels.slice(before)).toMatchObject([
      {
        kind: "form.submitted",
        tenantId: biz.tenantId,
        form: {
          name: "Sam Patel",
          email: "sam@example.com",
          source: "hosted",
          contactConsent: true,
        },
      },
    ]);

    // Other websites, bots (honeypot / too fast) and missing consent are refused or dropped.
    const elsewhere = await h.app.inject({
      method: "POST",
      url: `/api/public/forms/${key}`,
      headers: { origin: "https://evil.example" },
      payload: hosted(),
    });
    expect(elsewhere.statusCode).toBe(404);
    for (const payload of [hosted({ website: "http://spam" }), hosted({ elapsedMs: 300 })]) {
      const res = await h.app.inject({
        method: "POST",
        url: `/api/public/forms/${key}`,
        headers: { origin: ORIGIN },
        payload,
      });
      expect(res.statusCode).toBe(202);
    }
    const noConsent = await h.app.inject({
      method: "POST",
      url: `/api/public/forms/${key}`,
      headers: { origin: ORIGIN },
      payload: hosted({ consent: false }),
    });
    expect(noConsent.statusCode).toBe(400);
    expect(h.jobs.channels.length).toBe(before + 1);
  });

  it("accepts webhooks with the secret, JSON or form-encoded", async () => {
    const view = await enable({ message: "enquiry" });
    const before = h.jobs.channels.length;
    const wrong = await h.app.inject({
      method: "POST",
      url: `/api/webhooks/forms/${view.key}?secret=nope`,
      payload: { name: "X" },
    });
    expect(wrong.statusCode).toBe(404);

    const json = await h.app.inject({
      method: "POST",
      url: view.webhookPath,
      payload: { name: "Jo", email: "jo@example.com", enquiry: "Price list?" },
    });
    expect(json.statusCode).toBe(202);
    const encoded = await h.app.inject({
      method: "POST",
      url: view.webhookPath,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "name=Kim&phone=07700900999&enquiry=Call+me+back",
    });
    expect(encoded.statusCode).toBe(202);
    expect(h.jobs.channels.slice(before)).toMatchObject([
      { form: { name: "Jo", email: "jo@example.com", message: "Price list?", source: "webhook" } },
      { form: { name: "Kim", phone: "07700900999", message: "Call me back" } },
    ]);
  });

  it("regenerating the key retires the old address", async () => {
    const old = await enable();
    const res = await h.app.inject({
      method: "POST",
      url: `${settingsUrl()}/regenerate`,
      headers: headers(),
    });
    const fresh = res.json<FormView>();
    expect(fresh.key).not.toBe(old.key);
    const gone = await h.app.inject({ method: "POST", url: old.webhookPath, payload: { a: "b" } });
    expect(gone.statusCode).toBe(404);
  });
});
