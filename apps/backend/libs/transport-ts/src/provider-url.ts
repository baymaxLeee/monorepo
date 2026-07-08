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

function combineAbortSignals(
  signals: (AbortSignal | null | undefined)[],
): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => Boolean(s));
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}

function monitorStall(
  body: ReadableStream<Uint8Array>,
  onChunk: () => void,
  onDone: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          onDone();
          controller.close();
          return;
        }
        onChunk();
        controller.enqueue(value);
      } catch (err) {
        onDone();
        controller.error(err);
      }
    },
    async cancel(reason) {
      onDone();
      await reader.cancel(reason);
    },
  });
}

/**
 * Like {@link secureProviderFetch} but with a *stall* timeout: it aborts only
 * after `stallTimeoutMs` of complete silence — no response headers, or no
 * streamed bytes — so it never truncates a provider that is actively producing
 * output, however long the whole generation runs.
 *
 * Use this for streaming LLM/vision calls (a chat completion that never answers
 * — e.g. an oversized vision request the endpoint accepts then hangs — must not
 * pin a run forever). Do NOT use it for blocking image/video generation POSTs,
 * which legitimately return no bytes for minutes.
 */
export function createSecureProviderFetch(options: { stallTimeoutMs: number }): typeof fetch {
  const { stallTimeoutMs } = options;
  const impl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    await assertPublicProviderUrl(url);
    if (!(stallTimeoutMs > 0)) {
      return fetch(input, { ...init, redirect: "error" });
    }

    const controller = new AbortController();
    const fail = () =>
      controller.abort(
        new DOMException(`provider sent no data for ${stallTimeoutMs}ms`, "TimeoutError"),
      );
    let timer: ReturnType<typeof setTimeout> = setTimeout(fail, stallTimeoutMs);
    const rearm = () => {
      clearTimeout(timer);
      timer = setTimeout(fail, stallTimeoutMs);
    };
    const stop = () => clearTimeout(timer);

    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = combineAbortSignals([callerSignal, controller.signal]);

    let response: Response;
    try {
      response = await fetch(input, { ...init, redirect: "error", signal });
    } catch (err) {
      stop();
      throw err;
    }
    if (!response.body) {
      stop();
      return response;
    }

    rearm();
    signal?.addEventListener("abort", stop, { once: true });
    const monitored = monitorStall(response.body, rearm, stop);
    return new Response(monitored, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  return impl;
}
