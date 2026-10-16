import { describe, expect, it } from "vitest";
import { assertCan, can, ForbiddenError, PERMISSIONS, permissionsFor } from "../src/permissions";

describe("permissions", () => {
  it("gives owners every permission", () => {
    expect(permissionsFor("owner")).toEqual([...PERMISSIONS]);
  });

  it("keeps billing and deletion owner-only", () => {
    expect(can("admin", "billing:manage")).toBe(false);
    expect(can("admin", "tenant:delete")).toBe(false);
    expect(can("admin", "members:invite")).toBe(true);
  });

  it("limits staff to day-to-day work", () => {
    expect(can("staff", "contacts:write")).toBe(true);
    expect(can("staff", "members:invite")).toBe(false);
    expect(can("staff", "agent:configure")).toBe(false);
    expect(can("staff", "audit:read")).toBe(false);
  });

  it("assertCan throws ForbiddenError", () => {
    expect(() => assertCan("staff", "billing:manage")).toThrow(ForbiddenError);
    expect(() => assertCan("owner", "billing:manage")).not.toThrow();
  });
});
