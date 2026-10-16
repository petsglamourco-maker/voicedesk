export interface PutObjectInput {
  key: string;
  body: Uint8Array | string;
  contentType?: string;
}

export interface ObjectStorage {
  readonly name: string;
  put(input: PutObjectInput): Promise<void>;
  /** Returns null when the object does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** Deletes every object under a prefix (used for tenant erasure). Returns count deleted. */
  deletePrefix(prefix: string): Promise<number>;
  /** Time-limited download URL. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Builds a storage key scoped to one tenant: `tenants/<tenantId>/<parts...>`.
 * All tenant data MUST be stored under its tenant prefix so it can be isolated and erased.
 */
export function tenantKey(tenantId: string, ...parts: string[]): string {
  for (const segment of [tenantId, ...parts]) {
    if (!SAFE_SEGMENT.test(segment) || segment === "." || segment === "..") {
      throw new Error(`Invalid storage key segment: ${JSON.stringify(segment)}`);
    }
  }
  return ["tenants", tenantId, ...parts].join("/");
}
