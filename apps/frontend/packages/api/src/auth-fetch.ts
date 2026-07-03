import { refreshSession } from "./session";
import { getToken, isAccessTokenValid } from "./storage";

function withAuth(init: RequestInit | undefined): RequestInit {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    headers.delete("Authorization");
  }
  return { credentials: "include", ...init, headers };
}

/**
 * Auth-aware `fetch` for streaming / raw-fetch calls that cannot go through the
 * axios instance (AI SDK `DefaultChatTransport`, SSE ingest, blob source).
 *
 * It is the single place that mirrors the axios 401 policy for those calls:
 * proactive refresh-ahead + single-flight refresh (shared `refreshSession`
 * promise) + reactive refresh-and-retry-once. Without it, an expired short
 * token fails the request with no retry, because the SDK/raw fetch never sees
 * the interceptor.
 *
 * Retry-once is safe here because every caller passes a re-usable body (a JSON
 * string built by the SDK, or a `FormData`) and a URL string — never an already
 * consumed `Request`/stream body. Do not pass a `Request` with a one-shot body.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!isAccessTokenValid()) {
    await refreshSession();
  }
  let response = await fetch(input, withAuth(init));
  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await fetch(input, withAuth(init));
    }
  }
  return response;
}
