// v0 interface — refined against the chosen provider's current API in Phase 2.

export interface NumberSearchQuery {
  countryCode: string; // ISO 3166-1 alpha-2
  /** Area code / locality hint, e.g. "020" or "London". */
  locality?: string;
  type?: "local" | "mobile" | "tollFree";
  capabilities?: Array<"voice" | "sms">;
  limit?: number;
}

export interface AvailableNumber {
  e164: string;
  locality?: string;
  monthlyCostMinor?: number; // provider price, minor units
  currency?: string;
  /** Some countries require address/identity documents before the number is issued. */
  requiresRegulatoryBundle: boolean;
}

export interface ProvisionedNumber {
  providerNumberId: string;
  e164: string;
  status: "active" | "pending_regulatory";
}

export interface TelephonyProvider {
  readonly name: string;
  searchNumbers(query: NumberSearchQuery): Promise<AvailableNumber[]>;
  purchaseNumber(e164: string, options: { bundleId?: string }): Promise<ProvisionedNumber>;
  releaseNumber(providerNumberId: string): Promise<void>;
}
