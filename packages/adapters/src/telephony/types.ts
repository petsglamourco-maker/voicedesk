/**
 * Buying phone numbers from a carrier (ADR 0032). A business is reviewed once by the carrier
 * (an "identity": Twilio's regulatory bundle), then numbers can be bought under it.
 */

export type NumberType = "local" | "mobile";

export interface NumberSearchQuery {
  /** ISO 3166-1 alpha-2, e.g. "GB". */
  countryCode: string;
  type: NumberType;
  /** Area code or digits the number should contain, e.g. "023" or "2382". */
  contains?: string;
  /** Town or city, e.g. "Southampton". */
  locality?: string;
  limit?: number;
}

export interface AvailableNumber {
  e164: string;
  /** Display form, e.g. "023 8272 1976". */
  friendly: string;
  locality: string | null;
}

/** What the carrier needs to know about a business before it issues numbers. */
export interface NumberIdentityDetails {
  countryCode: string;
  type: NumberType;
  businessName: string;
  /** e.g. "Companies House number". */
  registrationIdentifier: string;
  registrationNumber: string;
  website: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  address: {
    street: string;
    city: string;
    region: string;
    postalCode: string;
  };
}

export type IdentityStatus = "pending" | "approved" | "rejected";

export interface NumberIdentity {
  /** The carrier's review id (Twilio bundle sid). */
  id: string;
  /** The carrier's address id, needed again when buying. */
  addressId: string;
  status: IdentityStatus;
}

export interface CarrierNumbers {
  readonly name: string;
  searchAvailable(query: NumberSearchQuery): Promise<AvailableNumber[]>;
  /** Creates the business's record at the carrier and submits it for review. */
  submitIdentity(details: NumberIdentityDetails): Promise<NumberIdentity>;
  identityStatus(id: string): Promise<{ status: IdentityStatus; reason: string | null }>;
  /** Buys a number under an approved identity; calls go to `voiceUrl`. */
  buy(params: {
    e164: string;
    identityId: string;
    addressId: string;
    voiceUrl: string;
  }): Promise<{ carrierNumberId: string }>;
  release(carrierNumberId: string): Promise<void>;
}
