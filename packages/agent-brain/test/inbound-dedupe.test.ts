import { randomUUID } from "node:crypto";
import { closeDb } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimInbound } from "../src/inbound-dedupe";

/** Repeated webhook deliveries are handled once, however late (security audit M6). */
let dbs: TestDbs;
let a: string;
let b: string;
beforeAll(async () => {
  dbs = connectTestDbs();
  a = await createTestTenant(dbs.app, "Dedupe A");
  b = await createTestTenant(dbs.app, "Dedupe B");
});
afterAll(async () => {
  await closeDb(dbs.app);
  await closeDb(dbs.owner);
});

describe("claimInbound", () => {
  it("claims each message once per business and channel", async () => {
    const id = `wamid.${randomUUID()}`;
    expect(await claimInbound(dbs.app, a, "whatsapp", id)).toBe(true);
    expect(await claimInbound(dbs.app, a, "whatsapp", id)).toBe(false);
    expect(await claimInbound(dbs.app, a, "form", id)).toBe(true); // another channel
    expect(await claimInbound(dbs.app, b, "whatsapp", id)).toBe(true); // another business
  });
});
