import { runtimeRequest } from "../infrastructure/clients/runtime.js";

export function proxyRuntimeRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return runtimeRequest(request, `${url.pathname}${url.search}`);
}
