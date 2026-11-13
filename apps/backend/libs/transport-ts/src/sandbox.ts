import { InternalHttpClient, TransportError, type InternalClientOptions } from "./http.js";
import type { components } from "./schema/sandbox.js";

export type SandboxScope = components["schemas"]["SandboxScope"];
export type SandboxSession = components["schemas"]["SandboxSession"];
export type SandboxProcess = components["schemas"]["SandboxProcess"];
export type SandboxStart = components["schemas"]["SandboxStart"];
export type SandboxContinue = components["schemas"]["SandboxContinue"];
export type SandboxWorkspaceSnapshot = components["schemas"]["SandboxWorkspaceSnapshot"];

export class SandboxInternalClient {
  private readonly http: InternalHttpClient;
  constructor(private readonly options: Omit<InternalClientOptions, "service">) {
    this.http = new InternalHttpClient({ ...options, service: "sandbox", timeoutMs: options.timeoutMs ?? 60000 });
  }
  create(scope: SandboxScope): Promise<SandboxSession> {
    return this.http.requestJson({ method: "POST", path: "/sessions", body: scope });
  }
  start(id: string, input: SandboxStart, signal?: AbortSignal): Promise<SandboxProcess> {
    return this.http.requestJson({
      method: "POST",
      path: `/sessions/${encodeURIComponent(id)}/commands`,
      body: input,
      signal,
    });
  }
  write(id: string, processId: string, input: SandboxContinue, signal?: AbortSignal): Promise<SandboxProcess> {
    return this.http.requestJson({
      method: "POST",
      path: `/sessions/${encodeURIComponent(id)}/processes/${encodeURIComponent(processId)}`,
      body: input,
      signal,
    });
  }
  cancel(id: string, processId: string, scope: SandboxScope): Promise<SandboxProcess> {
    return this.http.requestJson({
      method: "DELETE",
      path: `/sessions/${encodeURIComponent(id)}/processes/${encodeURIComponent(processId)}`,
      headers: { "X-Sandbox-Scope": JSON.stringify(scope) },
    });
  }
  destroy(scope: SandboxScope): Promise<{ destroyed: boolean }> {
    return this.http.requestJson({
      method: "DELETE",
      path: "/sessions",
      headers: { "X-Sandbox-Scope": JSON.stringify(scope) },
    });
  }
  snapshot(id: string, scope: SandboxScope): Promise<SandboxWorkspaceSnapshot> {
    return this.http.requestJson({
      method: "POST",
      path: `/sessions/${encodeURIComponent(id)}/snapshot`,
      headers: { "X-Sandbox-Scope": JSON.stringify(scope) },
    });
  }
  acquireWorkspaceEdit(id: string, scope: SandboxScope, token?: string): Promise<{ token: string }> {
    return this.http.requestJson({
      method: "POST",
      path: `/sessions/${encodeURIComponent(id)}/workspace-edits`,
      headers: {
        "X-Sandbox-Scope": JSON.stringify(scope),
        ...(token ? { "X-Sandbox-Workspace-Edit": token } : {}),
      },
    });
  }
  releaseWorkspaceEdit(id: string, scope: SandboxScope, token: string): Promise<{ released: boolean }> {
    return this.http.requestJson({
      method: "DELETE",
      path: `/sessions/${encodeURIComponent(id)}/workspace-edits`,
      headers: { "X-Sandbox-Scope": JSON.stringify(scope) },
      body: { token },
    });
  }
  private async file(
    method: "GET" | "PUT",
    id: string,
    scope: SandboxScope,
    path: string,
    signal?: AbortSignal,
    body?: ReadableStream<Uint8Array>,
    workspaceEditToken?: string,
  ) {
    const url = new URL(`/sessions/${encodeURIComponent(id)}/files`, this.options.baseUrl);
    url.searchParams.set("path", path);
    const init: RequestInit & { duplex?: "half" } = {
      method,
      body,
      ...(body ? { duplex: "half" as const } : {}),
      headers: {
        ...this.options.propagatedHeaders?.(),
        "X-Caller-Service": this.options.callerService,
        "X-Internal-Token": this.options.internalToken,
        "X-Sandbox-Scope": JSON.stringify(scope),
        "Content-Type": "application/octet-stream",
        ...(workspaceEditToken ? { "X-Sandbox-Workspace-Edit": workspaceEditToken } : {}),
      },
      signal: AbortSignal.any([AbortSignal.timeout(180000), ...(signal ? [signal] : [])]),
    };
    const response = await (this.options.fetchImpl ?? fetch)(url, init);
    if (!response.ok)
      throw new TransportError(
        "sandbox",
        response.status,
        `sandbox file transfer failed: ${response.status}`,
        await response.text(),
      );
    return response;
  }
  async upload(
    id: string,
    scope: SandboxScope,
    path: string,
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
    workspaceEditToken?: string,
  ) {
    const response = await this.file("PUT", id, scope, path, signal, body, workspaceEditToken);
    await response.json();
  }
  async download(id: string, scope: SandboxScope, path: string, signal?: AbortSignal) {
    const response = await this.file("GET", id, scope, path, signal);
    if (!response.body) throw new Error("sandbox returned no file body");
    return response.body;
  }
}
