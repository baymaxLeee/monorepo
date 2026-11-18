import path from "node:path";
import { pathToFileURL } from "node:url";

export const APP_SCHEME = "app";
export const APP_ORIGIN = "app://platform";
export const APP_URL = `${APP_ORIGIN}/`;

type EmbeddedRequest =
  | { kind: "api"; path: string }
  | { kind: "file"; path: string }
  | { kind: "reject"; status: 400 | 404 };

interface ProtocolRequest extends Request {
  initiatorOrigin?: string;
}

interface ProtocolLike {
  handle(scheme: string, handler: (request: ProtocolRequest) => Response | Promise<Response>): void;
}

interface NetworkRequestInit extends RequestInit {
  duplex?: "half";
}

type NetworkFetch = (input: string | Request, init?: NetworkRequestInit) => Promise<Response>;

const remotes = new Map([
  ["/mfe-admin/", "mfe-admin"],
  ["/mfe-canvas/", "mfe-canvas"],
  ["/mfe-chat/", "mfe-chat"],
]);

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function bundledFile(root: string, directory: string, relative: string): EmbeddedRequest {
  const base = path.join(root, directory);
  const candidate = path.resolve(base, relative);
  return contained(base, candidate) ? { kind: "file", path: candidate } : { kind: "reject", status: 400 };
}

export function resolveEmbeddedRequest(root: string, rawUrl: string): EmbeddedRequest {
  if (/%2e|%2f|%5c/i.test(rawUrl)) return { kind: "reject", status: 400 };
  const url = new URL(rawUrl);
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== "platform") return { kind: "reject", status: 404 };
  if (url.pathname === "/api" || url.pathname.startsWith("/api/"))
    return { kind: "api", path: `${url.pathname}${url.search}` };
  for (const [prefix, directory] of remotes) {
    if (url.pathname.startsWith(prefix)) return bundledFile(root, directory, url.pathname.slice(prefix.length));
  }
  const relative = url.pathname.slice(1);
  const platformAsset = relative !== "" && path.posix.basename(url.pathname).includes(".");
  return bundledFile(root, "platform", platformAsset ? relative : "index.html");
}

export function registerEmbeddedPlatform(
  protocol: ProtocolLike,
  networkFetch: NetworkFetch,
  root: string,
  apiOrigin: string,
): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.initiatorOrigin && request.initiatorOrigin !== APP_ORIGIN)
      return new Response("Not found", { status: 404 });
    const resolved = resolveEmbeddedRequest(root, request.url);
    if (resolved.kind === "reject") return new Response("Not found", { status: resolved.status });
    if (resolved.kind === "file") {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", { status: 405 });
      return networkFetch(pathToFileURL(resolved.path).toString(), { method: request.method });
    }
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    if (headers.has("origin")) headers.set("origin", apiOrigin);
    headers.delete("referer");
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
    return networkFetch(`${apiOrigin}${resolved.path}`, {
      method: request.method,
      headers,
      body,
      ...(body ? { duplex: "half" } : {}),
      credentials: "include",
      redirect: "manual",
    });
  });
}
