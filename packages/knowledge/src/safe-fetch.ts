import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch, type Dispatcher } from "undici";

/**
 * SSRF-safe HTTP fetching for crawling customer websites.
 *
 * Every TCP connection (including each redirect hop) resolves the host through a lookup
 * that rejects private, loopback, link-local and other non-public addresses. Checking at
 * connect time (not before the request) closes DNS-rebinding gaps.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, octet) => (n << 8) + Number(octet), 0) >>> 0;
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = v4ToInt(ip);
    return !V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (v4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (lower === "::" || lower === "::1") return false;
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast
    return !/^(f[cd]|fe[89ab]|ff)/.test(lower);
  }
  return false;
}

export interface SafeFetchOptions {
  /** Test-only escape hatch: allow these exact hostnames even if they resolve privately. */
  allowPrivateHosts?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export interface FetchedResource {
  url: string; // final URL after redirects
  status: number;
  contentType: string;
  body: Buffer;
}

export const USER_AGENT = "VoiceDeskBot/1.0 (+https://voicedesk.local/bot)";

export function createSafeDispatcher(allowPrivateHosts: string[] = []): Dispatcher {
  const allowed = new Set(allowPrivateHosts.map((h) => h.toLowerCase()));
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return callback(err, "", 4);
          const list = addresses;
          const ok = allowed.has(hostname.toLowerCase())
            ? list
            : list.filter((a) => isPublicAddress(a.address));
          if (ok.length === 0) {
            return callback(
              new BlockedUrlError(`Blocked non-public address for ${hostname}`),
              "",
              4,
            );
          }
          // undici calls lookup with all: true and expects the array form.
          if ((options as { all?: boolean }).all) {
            return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, ok);
          }
          callback(null, ok[0]!.address, ok[0]!.family);
        });
      },
    },
  });
}

function assertHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Only http(s) URLs are allowed: ${raw}`);
  }
  if (url.username || url.password)
    throw new BlockedUrlError("URLs with credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) {
    throw new BlockedUrlError(`Blocked non-public address: ${host}`);
  }
  return url;
}

export function createSafeFetcher(options: SafeFetchOptions = {}) {
  const dispatcher = createSafeDispatcher(options.allowPrivateHosts);
  const allowLiteral = new Set((options.allowPrivateHosts ?? []).map((h) => h.toLowerCase()));
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;

  return async function safeFetch(rawUrl: string): Promise<FetchedResource> {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const url = allowLiteral.has(new URL(current).hostname.toLowerCase())
        ? new URL(current)
        : assertHttpUrl(current);
      const res = await fetch(url, {
        dispatcher,
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        headers: {
          "user-agent": options.userAgent ?? USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.5",
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel();
        current = new URL(res.headers.get("location")!, url).toString();
        continue;
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) {
        await res.body?.cancel();
        throw new Error(`Response too large (${declared} bytes)`);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      if (res.body) {
        for await (const chunk of res.body) {
          size += (chunk as Uint8Array).byteLength;
          if (size > maxBytes) throw new Error(`Response exceeded ${maxBytes} bytes`);
          chunks.push(Buffer.from(chunk as Uint8Array));
        }
      }
      return {
        url: url.toString(),
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body: Buffer.concat(chunks),
      };
    }
    throw new Error(`Too many redirects for ${rawUrl}`);
  };
}

export type SafeFetch = ReturnType<typeof createSafeFetcher>;
