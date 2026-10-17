import { MockLlmProvider } from "@voicedesk/adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

interface ProfileResponse {
  approved: { version: number; data: { summary: string } } | null;
  draft: { version: number; data: { summary: string } } | null;
  template: Record<string, unknown> & { businessName: string };
  aiAvailable: boolean;
}

describe("profile API (no AI configured)", () => {
  let h: TestHarness;
  let owner: Awaited<ReturnType<typeof createOwnerWithTenant>>;
  beforeAll(async () => {
    h = await createHarness();
    owner = await createOwnerWithTenant(h, "Profile Co");
  });
  afterAll(() => h.close());

  const url = () => `/api/tenants/${owner.tenantId}/profile`;
  const headers = () => ({ cookie: owner.cookie, origin: ORIGIN });

  it("returns an empty template and reports AI unavailable", async () => {
    const res = await h.app.inject({ method: "GET", url: url(), headers: headers() });
    const body = res.json<ProfileResponse>();
    expect(body).toMatchObject({ approved: null, draft: null, aiAvailable: false });
    expect(body.template.businessName).toBe("Profile Co");
    const gen = await h.app.inject({
      method: "POST",
      url: `${url()}/generate`,
      headers: headers(),
    });
    expect(gen.statusCode).toBe(409);
  });

  it("saves a manual draft, validates it, and approves it", async () => {
    const { template } = (
      await h.app.inject({ method: "GET", url: url(), headers: headers() })
    ).json<ProfileResponse>();

    const bad = await h.app.inject({
      method: "PUT",
      url: `${url()}/draft`,
      headers: headers(),
      payload: { ...template, services: "lots" },
    });
    expect(bad.statusCode).toBe(400);

    const saved = await h.app.inject({
      method: "PUT",
      url: `${url()}/draft`,
      headers: headers(),
      payload: { ...template, summary: "We fix boilers." },
    });
    expect(saved.json()).toEqual({ version: 1 });

    const approve = await h.app.inject({
      method: "POST",
      url: `${url()}/approve`,
      headers: headers(),
      payload: { version: 1 },
    });
    expect(approve.statusCode).toBe(204);

    const after = (
      await h.app.inject({ method: "GET", url: url(), headers: headers() })
    ).json<ProfileResponse>();
    expect(after.approved?.data.summary).toBe("We fix boilers.");
    expect(after.draft).toBeNull();
  });
});

describe("profile API (AI configured)", () => {
  it("queues generation", async () => {
    // Any provider not named "mock-llm" counts as configured.
    const llm = Object.assign(new MockLlmProvider(), { name: "test-llm" });
    const h = await createHarness({ llm });
    try {
      const owner = await createOwnerWithTenant(h, "AI Co");
      const res = await h.app.inject({
        method: "POST",
        url: `/api/tenants/${owner.tenantId}/profile/generate`,
        headers: { cookie: owner.cookie, origin: ORIGIN },
      });
      expect(res.statusCode).toBe(202);
      expect(h.jobs.ai).toContainEqual(
        expect.objectContaining({ kind: "profile.generate", tenantId: owner.tenantId }),
      );
    } finally {
      await h.close();
    }
  });
});
