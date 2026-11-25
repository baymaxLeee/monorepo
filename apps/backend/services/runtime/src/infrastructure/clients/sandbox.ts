import { propagationHeaders } from "#runtime/foundation";
import {
  RuntimeSandboxClient,
  type SandboxContinue,
  type SandboxProcess,
  type SandboxScope as TransportSandboxScope,
  type SandboxSession,
  type SandboxStart,
  type SandboxWorkspaceSnapshot,
} from "#runtime/transport";

import { getServerSettings } from "../../config/server.js";

export interface SandboxScope {
  session_id: string;
  run_id: string;
  attempt_epoch: string;
  workspace_generation: string;
}

export type SandboxAttemptScope = Omit<SandboxScope, "workspace_generation">;

function transportScope(scope: SandboxScope): TransportSandboxScope {
  return {
    session_id: scope.session_id,
    run_id: scope.run_id,
    attempt_epoch: scope.attempt_epoch,
    workspace_generation: scope.workspace_generation,
  };
}

export class RuntimeSandboxAdapter {
  constructor(private readonly client: RuntimeSandboxClient) {}

  create(scope: SandboxScope): Promise<SandboxSession> {
    return this.client.create(transportScope(scope));
  }

  start(
    id: string,
    input: Omit<SandboxStart, "scope"> & { scope: SandboxScope },
    signal?: AbortSignal,
  ): Promise<SandboxProcess> {
    return this.client.start(id, { ...input, scope: transportScope(input.scope) }, signal);
  }

  write(
    id: string,
    processId: string,
    input: Omit<SandboxContinue, "scope"> & { scope: SandboxScope },
    signal?: AbortSignal,
  ): Promise<SandboxProcess> {
    return this.client.write(id, processId, { ...input, scope: transportScope(input.scope) }, signal);
  }

  cancel(id: string, processId: string, scope: SandboxScope): Promise<SandboxProcess> {
    return this.client.cancel(id, processId, transportScope(scope));
  }

  destroy(scope: SandboxScope): Promise<{ destroyed: boolean }> {
    return this.client.destroy(transportScope(scope));
  }

  snapshot(id: string, scope: SandboxScope): Promise<SandboxWorkspaceSnapshot> {
    return this.client.snapshot(id, transportScope(scope));
  }

  inventory(id: string, scope: SandboxScope): Promise<SandboxWorkspaceSnapshot> {
    return this.client.inventory(id, transportScope(scope));
  }

  retain(id: string, scope: SandboxScope): Promise<{ retained: boolean }> {
    return this.client.retain(id, transportScope(scope));
  }

  acquireWorkspaceEdit(id: string, scope: SandboxScope, token?: string): Promise<{ token: string }> {
    return this.client.acquireWorkspaceEdit(id, transportScope(scope), token);
  }

  releaseWorkspaceEdit(id: string, scope: SandboxScope, token: string): Promise<{ released: boolean }> {
    return this.client.releaseWorkspaceEdit(id, transportScope(scope), token);
  }

  upload(
    id: string,
    scope: SandboxScope,
    path: string,
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
    workspaceEditToken?: string,
    conditions?: { mode?: "create" | "overwrite"; expectedSha256?: string },
  ): Promise<void> {
    return this.client.upload(id, transportScope(scope), path, body, signal, workspaceEditToken, conditions);
  }

  download(id: string, scope: SandboxScope, path: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    return this.client.download(id, transportScope(scope), path, signal);
  }

  deleteFile(
    id: string,
    scope: SandboxScope,
    path: string,
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.client.deleteFile(id, transportScope(scope), path, expectedSha256, signal);
  }
}

export function sandboxClient(): RuntimeSandboxAdapter {
  const settings = getServerSettings();
  return new RuntimeSandboxAdapter(
    new RuntimeSandboxClient({
      baseUrl: settings.sandboxRoleUrl,
      internalToken: settings.internalApiToken,
      callerService: "runtime",
      propagatedHeaders: propagationHeaders,
    }),
  );
}
