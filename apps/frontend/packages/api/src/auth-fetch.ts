import { getPlatformAuth } from "@repo/runtime";

function withAuth(init: RequestInit | undefined): RequestInit {
  const headers = new Headers(init?.headers);
  const token = getPlatformAuth()?.getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    headers.delete("Authorization");
  }
  return { credentials: "include", ...init, headers };
}

/**
 * Auth-aware `fetch` for streaming / raw-fetch calls that cannot go through the
 * axios instance (AI SDK `DefaultChatTransport`, blob source, multipart upload).
 *
 * It is the single place that mirrors the axios 401 policy for those calls:
 * proactive refresh-ahead, Platform-owned single-flight refresh, and one retry
 * after a 401. Without it, an expired short
 * token fails the request with no retry, because the SDK/raw fetch never sees
 * the interceptor.
 *
 * Retry-once is safe here because every caller passes a re-usable body (a JSON
 * string built by the SDK, `FormData`, or `File`) and a URL string — never an already
 * consumed `Request`/stream body. Do not pass a `Request` with a one-shot body.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!getPlatformAuth()?.isAccessTokenValid()) {
    await getPlatformAuth()?.refreshAccessToken();
  }
  let response = await fetch(input, withAuth(init));
  if (response.status === 401) {
    const refreshed = await getPlatformAuth()?.refreshAccessToken();
    if (refreshed) {
      response = await fetch(input, withAuth(init));
    }
  }
  return response;
}
