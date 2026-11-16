import { getSettings } from "../../bootstrap/config.js";

const authHeaders = [
  "X-Auth-User-ID",
  "X-Auth-Name",
  "X-Auth-Email",
  "X-Auth-Tenant-ID",
  "X-Auth-Workspace-ID",
  "X-Auth-Workspace-Role",
  "X-Auth-Roles",
];

export async function runtimeRequest(request: Request, path: string, body?: unknown): Promise<Response> {
  const settings = getSettings();
  const headers = new Headers();
  for (const name of authHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("X-Caller-Service", "chat");
  headers.set("X-Internal-Token", settings.internalApiToken);
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  const method = request.method;
  const requestBody =
    body === undefined && method !== "GET" && method !== "HEAD"
      ? request.body
      : body === undefined
        ? undefined
        : JSON.stringify(body);
  return fetch(`${settings.runtimeServiceUrl}${path}`, {
    method,
    headers,
    body: requestBody,
    signal: request.signal,
    duplex: requestBody instanceof ReadableStream ? "half" : undefined,
  });
}
