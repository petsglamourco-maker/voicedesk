import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Whether an IP address is on the public internet: the single SSRF check used for every
 * server-side connection to a customer-supplied host (website crawls, mailbox IMAP/SMTP).
 *
 * Built on node:net BlockList, which also matches IPv4-mapped IPv6 in every spelling
 * (`::ffff:127.0.0.1` and hex `::ffff:7f00:1`), closing that bypass. Transition prefixes that
 * can tunnel to internal IPv4 (NAT64, 6to4, Teredo, IPv4-compatible) are blocked outright.
 */
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 96], // unspecified, loopback and IPv4-compatible (::a.b.c.d)
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  return !blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

export class BlockedHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedHostError";
  }
}

/**
 * Resolves `host` and returns one public address to connect to (connect to this IP, with the
 * original host name for TLS), so a DNS answer can't change between the check and the
 * connection. Throws BlockedHostError if the host has no public address.
 */
export async function resolvePublicHost(host: string): Promise<{ address: string; family: 4 | 6 }> {
  const literal = host.replace(/^\[|\]$/g, "");
  if (isIP(literal)) {
    if (!isPublicAddress(literal)) throw new BlockedHostError("That address isn't allowed");
    return { address: literal, family: isIP(literal) as 4 | 6 };
  }
  const answers = await lookup(literal, { all: true, verbatim: true });
  if (answers.length === 0 || answers.some((a) => !isPublicAddress(a.address))) {
    // Any private answer blocks the host: mixed public/private records are a rebinding trick.
    throw new BlockedHostError("That host isn't on the public internet");
  }
  return { address: answers[0]!.address, family: answers[0]!.family as 4 | 6 };
}
