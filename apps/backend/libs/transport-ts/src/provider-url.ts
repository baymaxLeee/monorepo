// SSRF guard for outbound calls to admin-configured LLM provider base URLs.
// Shared by chat and executor (both call user-configured providers) — kept
// here instead of duplicated per-service so the blocklist can't silently
// drift between copies.
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["100::", 64],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

function assertPublicAddress(address: string, family: 4 | 6): void {
  const blocked = family === 4 ? blockedIpv4 : blockedIpv6;
  const type = family === 4 ? "ipv4" : "ipv6";
  if (blocked.check(address, type)) {
    throw new Error("provider base URL resolves to a private or reserved address");
  }
}

export async function assertPublicProviderUrl(value: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("provider base URL must be an absolute HTTP(S) URL");
  }
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) {
    throw new Error("provider base URL must use HTTP(S)");
  }
  if (parsed.username || parsed.password) {
    throw new Error("provider base URL must not contain credentials");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("provider base URL must use a public host");
  }

  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    assertPublicAddress(hostname, literalFamily);
    return;
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error("provider base URL host could not be resolved");
  for (const record of records) {
    if (record.family === 4 || record.family === 6) {
      assertPublicAddress(record.address, record.family);
    }
  }
}

export const secureProviderFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : input.toString();
  await assertPublicProviderUrl(url);
  return fetch(input, { ...init, redirect: "error" });
};
