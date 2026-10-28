import { ProviderError } from "../errors";
import type {
  AvailableNumber,
  CarrierNumbers,
  IdentityStatus,
  NumberIdentity,
  NumberIdentityDetails,
  NumberSearchQuery,
  NumberType,
} from "./types";

/** Calling codes for the country packs (ADR 0031), to anchor area-code searches. */
const CALLING_CODES: Record<string, string> = {
  GB: "44",
  IE: "353",
  US: "1",
  CA: "1",
  AU: "61",
  NZ: "64",
};

/**
 * Twilio numbers (ADR 0032): available-number search, the regulatory bundle a business needs
 * before it gets numbers (end user + address + bundle, reviewed by Twilio), buying and
 * releasing. Searching and submitting for review are free; buying costs money.
 */
export class TwilioNumbers implements CarrierNumbers {
  readonly name = "twilio-numbers";
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      accountSid: string;
      authToken: string;
      apiBase?: string;
      numbersBase?: string;
      fetch?: typeof fetch;
    },
  ) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  private get api() {
    return `${this.options.apiBase ?? "https://api.twilio.com"}/2010-04-01/Accounts/${encodeURIComponent(this.options.accountSid)}`;
  }

  private get numbers() {
    return `${this.options.numbersBase ?? "https://numbers.twilio.com"}/v2/RegulatoryCompliance`;
  }

  private async call<T>(
    url: string,
    init: { method?: string; form?: Record<string, string> } = {},
  ): Promise<T> {
    const auth = Buffer.from(`${this.options.accountSid}:${this.options.authToken}`).toString(
      "base64",
    );
    const res = await this.fetchImpl(url, {
      method: init.method ?? (init.form ? "POST" : "GET"),
      headers: {
        authorization: `Basic ${auth}`,
        ...(init.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new ProviderError(this.name, `HTTP ${res.status}: ${detail}`, {
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async searchAvailable(query: NumberSearchQuery): Promise<AvailableNumber[]> {
    const kind = query.type === "mobile" ? "Mobile" : "Local";
    const params = new URLSearchParams({ PageSize: String(query.limit ?? 10) });
    if (query.contains) {
      // An area code matches the start of the number: "023 8" → "+44238*".
      const digits = query.contains.replace(/\D/g, "").replace(/^0/, "");
      const code = CALLING_CODES[query.countryCode.toUpperCase()];
      if (digits) params.set("Contains", code ? `+${code}${digits}*` : digits);
    }
    if (query.locality) params.set("InLocality", query.locality);
    const body = await this.call<{
      available_phone_numbers?: Array<{
        phone_number: string;
        friendly_name: string;
        locality: string | null;
      }>;
    }>(
      `${this.api}/AvailablePhoneNumbers/${encodeURIComponent(query.countryCode)}/${kind}.json?${params.toString()}`,
    );
    return (body.available_phone_numbers ?? []).map((n) => ({
      e164: n.phone_number,
      friendly: n.friendly_name,
      locality: n.locality || null,
    }));
  }

  private async regulationSid(countryCode: string, type: NumberType): Promise<string> {
    const params = new URLSearchParams({
      IsoCountry: countryCode,
      NumberType: type,
      EndUserType: "business",
    });
    const body = await this.call<{ results?: Array<{ sid: string }> }>(
      `${this.numbers}/Regulations?${params.toString()}`,
    );
    const sid = body.results?.[0]?.sid;
    if (!sid) {
      throw new ProviderError(this.name, `No ${type} regulation for ${countryCode}`, {
        retryable: false,
      });
    }
    return sid;
  }

  async submitIdentity(details: NumberIdentityDetails): Promise<NumberIdentity> {
    const regulation = await this.regulationSid(details.countryCode, details.type);
    const address = await this.call<{ sid: string }>(`${this.api}/Addresses.json`, {
      form: {
        CustomerName: details.businessName,
        Street: details.address.street,
        City: details.address.city,
        Region: details.address.region,
        PostalCode: details.address.postalCode,
        IsoCountry: details.countryCode,
        FriendlyName: details.businessName,
      },
    });
    const endUser = await this.call<{ sid: string }>(`${this.numbers}/EndUsers`, {
      form: {
        FriendlyName: details.businessName,
        Type: "business",
        Attributes: JSON.stringify({
          business_name: details.businessName,
          business_registration_identifier: details.registrationIdentifier,
          business_registration_number: details.registrationNumber,
          business_website: details.website,
          first_name: details.contactFirstName,
          last_name: details.contactLastName,
          email: details.contactEmail,
          phone_number: details.contactPhone,
          // We buy numbers on the business's behalf.
          business_identity: "isv_reseller_or_partner",
          is_subassigned: "YES",
        }),
      },
    });
    const document = await this.call<{ sid: string }>(`${this.numbers}/SupportingDocuments`, {
      form: {
        FriendlyName: `${details.businessName} address`,
        Type: "business_address",
        Attributes: JSON.stringify({ address_sids: [address.sid] }),
      },
    });
    const bundle = await this.call<{ sid: string }>(`${this.numbers}/Bundles`, {
      form: {
        FriendlyName: details.businessName.slice(0, 64),
        Email: details.contactEmail,
        RegulationSid: regulation,
        EndUserType: "business",
        IsoCountry: details.countryCode,
        NumberType: details.type,
      },
    });
    for (const item of [endUser.sid, document.sid]) {
      await this.call(`${this.numbers}/Bundles/${bundle.sid}/ItemAssignments`, {
        form: { ObjectSid: item },
      });
    }
    await this.call(`${this.numbers}/Bundles/${bundle.sid}`, {
      form: { Status: "pending-review" },
    });
    return { id: bundle.sid, addressId: address.sid, status: "pending" };
  }

  async identityStatus(id: string): Promise<{ status: IdentityStatus; reason: string | null }> {
    const bundle = await this.call<{ status: string }>(
      `${this.numbers}/Bundles/${encodeURIComponent(id)}`,
    );
    if (bundle.status === "twilio-approved") return { status: "approved", reason: null };
    if (bundle.status === "twilio-rejected") {
      const evaluations = await this.call<{
        results?: Array<{ results?: Array<{ failure_reason?: string }> }>;
      }>(`${this.numbers}/Bundles/${encodeURIComponent(id)}/Evaluations`).catch(() => null);
      const reason =
        evaluations?.results?.[0]?.results?.find((r) => r.failure_reason)?.failure_reason ?? null;
      return { status: "rejected", reason };
    }
    return { status: "pending", reason: null };
  }

  async buy(params: {
    e164: string;
    identityId: string;
    addressId: string;
    voiceUrl: string;
  }): Promise<{ carrierNumberId: string }> {
    const number = await this.call<{ sid: string }>(`${this.api}/IncomingPhoneNumbers.json`, {
      form: {
        PhoneNumber: params.e164,
        BundleSid: params.identityId,
        AddressSid: params.addressId,
        VoiceUrl: params.voiceUrl,
        VoiceMethod: "POST",
      },
    });
    return { carrierNumberId: number.sid };
  }

  async release(carrierNumberId: string): Promise<void> {
    await this.call(
      `${this.api}/IncomingPhoneNumbers/${encodeURIComponent(carrierNumberId)}.json`,
      {
        method: "DELETE",
      },
    );
  }
}
