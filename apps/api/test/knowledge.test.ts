import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  signUpVerified,
  type TestHarness,
} from "./harness";

let h: TestHarness;
let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;

beforeAll(async () => {
  h = await createHarness();
  owner = await createOwnerWithTenant(h, "Knowledge Co");
});

afterAll(() => h.close());

const base = () => `/api/tenants/${owner.tenantId}/knowledge`;
const asOwner = () => ({ cookie: owner.cookie, origin: ORIGIN });

function multipart(fileName: string, content: string, type: string) {
  const boundary = "----voicedesk-test";
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${type}\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("knowledge API", () => {
  it("adds a text source, processes it and makes it searchable", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `${base()}/sources`,
      headers: asOwner(),
      payload: {
        type: "text",
        title: "Policies",
        text: "# Cancellation policy\n\nPlease give 24 hours notice to cancel an appointment.",
      },
    });
    expect(res.statusCode).toBe(201);

    const list = await h.app.inject({
      method: "GET",
      url: `${base()}/sources`,
      headers: asOwner(),
    });
    const policies = list
      .json<Array<{ title: string; status: string }>>()
      .find((s) => s.title === "Policies");
    expect(policies?.status).toBe("ready");

    const search = await h.app.inject({
      method: "GET",
      url: `${base()}/search?q=${encodeURIComponent("how much notice to cancel")}`,
      headers: asOwner(),
    });
    expect(search.json<Array<{ content: string }>>()[0]?.content).toContain("24 hours");
  });

  it("uploads and processes a file", async () => {
    const { body, contentType } = multipart(
      "prices.csv",
      "Service,Price\nWhitening,£250\n",
      "text/csv",
    );
    const res = await h.app.inject({
      method: "POST",
      url: `${base()}/files`,
      headers: { ...asOwner(), "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ status: string }>()).toMatchObject({ status: "pending" });
    const list = await h.app.inject({
      method: "GET",
      url: `${base()}/sources`,
      headers: asOwner(),
    });
    expect(list.json<Array<{ fileName: string | null; status: string }>>()).toContainEqual(
      expect.objectContaining({ fileName: "prices.csv", status: "ready" }),
    );
  });

  it("rejects unsupported files and unsafe website addresses", async () => {
    const { body, contentType } = multipart("virus.exe", "MZ", "application/octet-stream");
    const file = await h.app.inject({
      method: "POST",
      url: `${base()}/files`,
      headers: { ...asOwner(), "content-type": contentType },
      payload: body,
    });
    expect(file.statusCode).toBe(400);

    for (const url of [
      "http://127.0.0.1/admin",
      "http://169.254.169.254/",
      "ftp://example.com",
      "localhost",
    ]) {
      const res = await h.app.inject({
        method: "POST",
        url: `${base()}/sources`,
        headers: asOwner(),
        payload: { type: "website", url },
      });
      expect(res.statusCode, url).toBe(400);
    }
  });

  it("schedules weekly recrawls for websites by default", async () => {
    const before = h.jobs.recrawls.length;
    const res = await h.app.inject({
      method: "POST",
      url: `${base()}/sources`,
      headers: asOwner(),
      payload: { type: "website", url: "example.invalid" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ url: string }>().url).toBe("https://example.invalid/");
    expect(h.jobs.recrawls.slice(before)).toEqual([[res.json<{ id: string }>().id, 7]]);
  });

  it("lets staff read but not change knowledge, and hides it from outsiders", async () => {
    const outsider = await signUpVerified(h, "Outsider");
    const asOutsider = await h.app.inject({
      method: "GET",
      url: `${base()}/sources`,
      headers: { cookie: outsider.cookie },
    });
    expect(asOutsider.statusCode).toBe(404);

    const staff = await signUpVerified(h, "Staff");
    await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/invite-member",
      headers: asOwner(),
      payload: { email: staff.email, role: "staff", organizationId: owner.tenantId },
    });
    const invitationId = /accept-invite\/([0-9a-f-]{36})/.exec(
      h.outbox.findLast((m) => m.to === staff.email)!.text,
    )![1];
    await h.app.inject({
      method: "POST",
      url: "/api/auth/organization/accept-invitation",
      headers: { cookie: staff.cookie, origin: ORIGIN },
      payload: { invitationId },
    });

    const read = await h.app.inject({
      method: "GET",
      url: `${base()}/sources`,
      headers: { cookie: staff.cookie },
    });
    expect(read.statusCode).toBe(200);
    const write = await h.app.inject({
      method: "POST",
      url: `${base()}/sources`,
      headers: { cookie: staff.cookie, origin: ORIGIN },
      payload: { type: "text", title: "x", text: "staff should not add this" },
    });
    expect(write.statusCode).toBe(403);
  });

  it("deletes a source and its knowledge", async () => {
    const created = await h.app.inject({
      method: "POST",
      url: `${base()}/sources`,
      headers: asOwner(),
      payload: { type: "text", title: "Temp", text: "The secret word is pineapple marmalade." },
    });
    const id = created.json<{ id: string }>().id;
    const del = await h.app.inject({
      method: "DELETE",
      url: `${base()}/sources/${id}`,
      headers: asOwner(),
    });
    expect(del.statusCode).toBe(204);
    const search = await h.app.inject({
      method: "GET",
      url: `${base()}/search?q=pineapple%20marmalade`,
      headers: asOwner(),
    });
    expect(
      search.json<Array<{ content: string }>>().some((x) => x.content.includes("pineapple")),
    ).toBe(false);
  });
});
