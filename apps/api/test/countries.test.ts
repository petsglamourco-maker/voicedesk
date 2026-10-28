import { checkSend, getPlatformSpendSettings, loadAgentContext } from "@voicedesk/agent-brain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  createOwnerWithTenant,
  ORIGIN,
  signUpVerified,
  type TestHarness,
} from "./harness";

let ukOnly: TestHarness;
let withIreland: TestHarness;

beforeAll(async () => {
  ukOnly = await createHarness({ countrySettings: { launched: [], smsRegistered: [] } });
  withIreland = await createHarness({
    countrySettings: { launched: ["IE", "US"], smsRegistered: [] },
  });
});
afterAll(async () => {
  await ukOnly.close();
  await withIreland.close();
});

async function createBusiness(h: TestHarness, countryCode: string, timezone: string) {
  const owner = await signUpVerified(h, "Owner");
  return h.app.inject({
    method: "POST",
    url: "/api/tenants",
    headers: { cookie: owner.cookie, origin: ORIGIN },
    payload: { name: `${countryCode} Co`, countryCode, timezone, defaultLanguage: "en" },
  });
}

describe("country launches (ADR 0031)", () => {
  it("only launched countries are offered and accepted", async () => {
    const list = await ukOnly.app.inject({ method: "GET", url: "/api/public/countries" });
    expect(
      list.json<{ countries: Array<{ code: string }> }>().countries.map((c) => c.code),
    ).toEqual(["GB"]);
    const refused = await createBusiness(ukOnly, "IE", "Europe/Dublin");
    expect(refused.json()).toMatchObject({ error: "COUNTRY_NOT_LAUNCHED" });
  });

  it("a launched country gets its own time zones, emergency number and rules", async () => {
    const list = await withIreland.app.inject({ method: "GET", url: "/api/public/countries" });
    const countries = list.json<{
      countries: Array<{ code: string; timezones: string[]; currency: string }>;
    }>().countries;
    expect(countries.map((c) => c.code)).toEqual(["GB", "IE", "US"]);
    expect(countries.find((c) => c.code === "US")).toMatchObject({ currency: "USD" });

    const created = await createBusiness(withIreland, "IE", "Europe/Dublin");
    expect(created.statusCode).toBe(201);
    const ctx = await loadAgentContext(withIreland.db, created.json<{ id: string }>().id, "chat");
    expect(ctx.emergencyNumber).toBe("112");
  });

  it("US texts wait for 10DLC registration; calls don't", async () => {
    const biz = await createOwnerWithTenant(withIreland, "Texting Co");
    const settings = {
      ...(await getPlatformSpendSettings(withIreland.db)),
      allowedCountries: ["GB", "US"],
    };
    const check = (kind: "sms" | "call", smsRegistered: string[]) =>
      checkSend(withIreland.db, {
        tenantId: biz.tenantId,
        kind,
        to: "+12125550142",
        settings,
        countries: { launched: ["US"], smsRegistered },
      });
    expect(await check("sms", [])).toEqual({ ok: false, reason: "unregistered" });
    expect(await check("sms", ["US"])).toEqual({ ok: true });
    expect(await check("call", [])).toEqual({ ok: true });
  });

  it("Platform admin → Countries is for the platform owner only", async () => {
    const outsider = await createOwnerWithTenant(ukOnly, "Nosy Co");
    const res = await ukOnly.app.inject({
      method: "GET",
      url: "/api/platform/countries",
      headers: { cookie: outsider.cookie },
    });
    expect(res.statusCode).toBe(404);
    const write = await ukOnly.app.inject({
      method: "PUT",
      url: "/api/platform/countries",
      headers: { cookie: outsider.cookie, origin: ORIGIN },
      payload: { launched: ["US"], smsRegistered: [] },
    });
    expect(write.statusCode).toBe(404);
  });
});
