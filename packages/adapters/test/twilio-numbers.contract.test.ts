import { describe, expect, it } from "vitest";
import { TwilioNumbers } from "../src/telephony/twilio-numbers";
import { MockCarrierNumbers } from "../src/mocks";
import type { NumberIdentityDetails } from "../src/telephony/types";

interface Call {
  method: string;
  url: string;
  form: Record<string, string>;
}

/** A fake Twilio that answers each endpoint and records the calls. */
function fakeTwilio(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fetch = ((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const form = Object.fromEntries(
      new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
    );
    calls.push({ method, url, form });
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    for (const [match, body] of Object.entries(overrides)) {
      if (url.includes(match)) return json(body);
    }
    if (url.includes("/AvailablePhoneNumbers/GB/Local.json")) {
      return json({
        available_phone_numbers: [
          {
            phone_number: "+442382721100",
            friendly_name: "023 8272 1100",
            locality: "Southampton",
          },
        ],
      });
    }
    if (url.includes("/Regulations?")) return json({ results: [{ sid: "RN123" }] });
    if (url.endsWith("/Addresses.json")) return json({ sid: "AD123" });
    if (url.endsWith("/EndUsers")) return json({ sid: "IT123" });
    if (url.endsWith("/SupportingDocuments")) return json({ sid: "RD123" });
    if (url.endsWith("/Bundles")) return json({ sid: "BU123" });
    if (url.includes("/ItemAssignments")) return json({ sid: "BV1" });
    if (url.endsWith("/Bundles/BU123") && method === "POST") return json({ sid: "BU123" });
    if (url.endsWith("/Bundles/BU123")) return json({ status: "twilio-approved" });
    if (url.endsWith("/IncomingPhoneNumbers.json")) return json({ sid: "PN123" });
    if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    return json({ message: "not found" }, 404);
  }) as typeof globalThis.fetch;
  return {
    calls,
    numbers: new TwilioNumbers({ accountSid: "AC1", authToken: "secret", fetch }),
  };
}

const DETAILS: NumberIdentityDetails = {
  countryCode: "GB",
  type: "local",
  businessName: "Glow Studio Ltd",
  registrationIdentifier: "Companies House",
  registrationNumber: "12345678",
  website: "https://glow-studio.test",
  contactFirstName: "Sam",
  contactLastName: "Lee",
  contactEmail: "sam@glow-studio.test",
  contactPhone: "+447700900123",
  address: {
    street: "1 High Street",
    city: "Southampton",
    region: "Hampshire",
    postalCode: "SO14 1AA",
  },
};

describe("TwilioNumbers (ADR 0032)", () => {
  it("searches local numbers by area code, anchored at the start", async () => {
    const { calls, numbers } = fakeTwilio();
    const found = await numbers.searchAvailable({
      countryCode: "GB",
      type: "local",
      contains: "023 8",
    });
    expect(found).toEqual([
      { e164: "+442382721100", friendly: "023 8272 1100", locality: "Southampton" },
    ]);
    expect(calls[0]?.url).toContain("/Accounts/AC1/AvailablePhoneNumbers/GB/Local.json?");
    expect(calls[0]?.url).toContain(`Contains=${encodeURIComponent("+44238*")}`);
  });

  it("submits a business for review: address, end user, document, bundle, then pending-review", async () => {
    const { calls, numbers } = fakeTwilio();
    const identity = await numbers.submitIdentity(DETAILS);
    expect(identity).toEqual({ id: "BU123", addressId: "AD123", status: "pending" });
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.url.split("/").slice(-1)[0])).toEqual([
      "Addresses.json",
      "EndUsers",
      "SupportingDocuments",
      "Bundles",
      "ItemAssignments",
      "ItemAssignments",
      "BU123",
    ]);
    const endUser = JSON.parse(posts[1]!.form.Attributes!) as Record<string, string>;
    expect(endUser).toMatchObject({
      business_name: "Glow Studio Ltd",
      business_registration_number: "12345678",
      business_identity: "isv_reseller_or_partner",
      is_subassigned: "YES",
    });
    expect(JSON.parse(posts[2]!.form.Attributes!)).toEqual({ address_sids: ["AD123"] });
    expect(posts[3]!.form).toMatchObject({ RegulationSid: "RN123", NumberType: "local" });
    expect(posts[6]!.form).toEqual({ Status: "pending-review" });
    // Basic auth, never the token in the URL.
    expect(calls.every((c) => !c.url.includes("secret"))).toBe(true);
  });

  it("reads the review result, with the reason when rejected", async () => {
    expect(await fakeTwilio().numbers.identityStatus("BU123")).toEqual({
      status: "approved",
      reason: null,
    });
    const rejected = fakeTwilio({
      "/Evaluations": { results: [{ results: [{ failure_reason: "Address mismatch" }] }] },
      "/Bundles/BU9": { status: "twilio-rejected" },
    });
    expect(await rejected.numbers.identityStatus("BU9")).toEqual({
      status: "rejected",
      reason: "Address mismatch",
    });
  });

  it("buys under the approved bundle with our voice URL, and releases", async () => {
    const { calls, numbers } = fakeTwilio();
    const bought = await numbers.buy({
      e164: "+442382721100",
      identityId: "BU123",
      addressId: "AD123",
      voiceUrl: "https://handler.twilio.com/twiml/EH1",
    });
    expect(bought).toEqual({ carrierNumberId: "PN123" });
    expect(calls.at(-1)?.form).toEqual({
      PhoneNumber: "+442382721100",
      BundleSid: "BU123",
      AddressSid: "AD123",
      VoiceUrl: "https://handler.twilio.com/twiml/EH1",
      VoiceMethod: "POST",
    });
    await numbers.release("PN123");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
    expect(calls.at(-1)?.url).toContain("/IncomingPhoneNumbers/PN123.json");
  });
});

describe("MockCarrierNumbers", () => {
  it("behaves like the carrier: review, then buy once", async () => {
    const mock = new MockCarrierNumbers();
    const identity = await mock.submitIdentity(DETAILS);
    expect((await mock.identityStatus(identity.id)).status).toBe("pending");
    mock.decide(identity.id, "approved");
    expect((await mock.identityStatus(identity.id)).status).toBe("approved");
    const [first] = await mock.searchAvailable({ countryCode: "GB", type: "local" });
    await mock.buy({
      e164: first!.e164,
      identityId: identity.id,
      addressId: identity.addressId,
      voiceUrl: "x",
    });
    await expect(
      mock.buy({
        e164: first!.e164,
        identityId: identity.id,
        addressId: identity.addressId,
        voiceUrl: "x",
      }),
    ).rejects.toThrow();
  });
});
