import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registeredRoutes } from "../src/app";
import { createHarness, createOwnerWithTenant, ORIGIN, type TestHarness } from "./harness";

/**
 * Generic access check (security audit M11, IDOR): every /api/tenants/:tenantId/... route must
 * answer an outsider with 404, so no business's data can be reached through another's login.
 */
let h: TestHarness;
let victim: Awaited<ReturnType<typeof createOwnerWithTenant>>;
let outsider: Awaited<ReturnType<typeof createOwnerWithTenant>>;
beforeAll(async () => {
  h = await createHarness();
  victim = await createOwnerWithTenant(h, "Victim Co");
  outsider = await createOwnerWithTenant(h, "Outsider Co");
});
afterAll(() => h.close());

describe("every tenant route refuses outsiders", () => {
  it("answers 404 (not data, not 403) to another business's owner", async () => {
    const routes = (registeredRoutes.get(h.app) ?? []).filter(
      (r) => r.url.startsWith("/api/tenants/:tenantId") && r.method !== "HEAD",
    );
    expect(routes.length).toBeGreaterThan(60);
    const problems: string[] = [];
    for (const r of routes) {
      const url = r.url
        .replace(":tenantId", victim.tenantId)
        .replace(/:[A-Za-z]+/g, () => randomUUID());
      const res = await h.app.inject({
        method: r.method as "GET",
        url,
        headers: { cookie: outsider.cookie, origin: ORIGIN },
        ...(r.method === "GET" || r.method === "DELETE" ? {} : { payload: {} }),
      });
      if (![404, 400].includes(res.statusCode))
        problems.push(`${r.method} ${r.url} → ${res.statusCode}`);
    }
    expect(problems).toEqual([]);
  });
});
