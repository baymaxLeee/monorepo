import type {
  StorageInternalClient,
  KnowledgeDocument,
  SandboxInternalClient,
  SandboxProcess,
  SandboxScope,
  SandboxSession,
} from "@backend/transport-ts";

import { createMediaDocument, listDocuments, listVirtualFiles } from "../../../../infrastructure/clients/knowledge.js";
import { sandboxClient } from "../../../../infrastructure/clients/sandbox.js";
import { storageClient } from "../../../../infrastructure/clients/storage.js";
import { logger } from "../../../../infrastructure/observability/logger.js";
import type { ArtifactToolContext } from "../context.js";

export interface SandboxDependencies {
  sandbox: () => Pick<SandboxInternalClient, "create" | "destroy" | "start" | "write" | "upload" | "download">;
  asset: () => Pick<StorageInternalClient, "content" | "upload">;
  documents: typeof listDocuments;
  files: typeof listVirtualFiles;
  publish: typeof createMediaDocument;
}
const defaults: SandboxDependencies = {
  sandbox: sandboxClient,
  asset: storageClient,
  documents: listDocuments,
  files: listVirtualFiles,
  publish: createMediaDocument,
};

export function documentSandboxPath(document: Pick<KnowledgeDocument, "id" | "filename" | "source_filename">) {
  const name =
    (document.source_filename || document.filename).replace(/[^\p{L}\p{N}._-]/gu, "-").replace(/^\.+/, "") || "file";
  return `sources/documents/${encodeURIComponent(document.id)}/${name}`;
}

export class RunSandbox {
  private scope?: SandboxScope;
  private initializing?: Promise<SandboxSession>;
  private disposal?: Promise<void>;
  private closed = false;
  private readonly abort = new AbortController();
  private readonly processes = new Map<string, SandboxProcess>();
  private readonly stopListeners = new Map<AbortSignal, () => void>();
  private manifest: Array<{ path: string; document_id?: string; conversation_path?: string }> = [];
  constructor(private readonly deps: SandboxDependencies = defaults) {}

  private bind(context: ArtifactToolContext, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.closed) throw new Error("This run's sandbox is closed; temporary files are no longer available.");
    const scope = {
      tenant_id: context.tenantId,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      conversation_id: context.conversationId,
      run_id: context.runId,
    };
    if (this.scope && JSON.stringify(this.scope) !== JSON.stringify(scope)) throw new Error("sandbox context mismatch");
    this.scope = scope;
    if (signal && !this.stopListeners.has(signal)) {
      const listener = () => {
        void this.dispose().catch((error) => logger.error({ err: error }, "sandbox stop cleanup failed"));
      };
      signal.addEventListener("abort", listener, { once: true });
      this.stopListeners.set(signal, listener);
    }
    return scope;
  }
  async ensure(context: ArtifactToolContext, signal?: AbortSignal) {
    const scope = this.bind(context, signal);
    this.initializing ??= (async () => {
      // Provisioning is bounded by the transport timeout. Finish observing create
      // before DELETE so Stop cannot race a late successful resource creation.
      const session = await this.deps.sandbox().create(scope);
      this.abort.signal.throwIfAborted();
      await this.hydrate(session.id, context);
      return session;
    })();
    try {
      return await this.initializing;
    } catch (error) {
      await this.dispose();
      signal?.throwIfAborted();
      throw error;
    }
  }
  private async hydrate(id: string, context: ArtifactToolContext) {
    const scope = this.scope!;
    const signal = this.abort.signal;
    const client = this.deps.sandbox();
    const documents = await this.deps.documents(context.userId, context.conversationId);
    this.manifest = [];
    for (const summary of documents) {
      signal.throwIfAborted();
      const document = summary;
      if (
        document.user_id !== context.userId ||
        document.conversation_id !== context.conversationId ||
        (document.tenant_id != null && document.tenant_id !== context.tenantId) ||
        (document.workspace_id != null && document.workspace_id !== context.workspaceId)
      ) {
        throw new Error("conversation attachment scope mismatch");
      }
      const path = documentSandboxPath(document);
      if (!document.asset_id || !document.source_revision_id) throw new Error("attachment has no Storage revision");
      const body = await this.deps.asset().content({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        assetId: document.asset_id,
        revisionId: document.source_revision_id,
        signal,
      });
      try {
        await client.upload(id, scope, path, body, signal);
      } finally {
        if (!body.locked) await body.cancel().catch(() => {});
      }
      this.manifest.push({ path: `/workspace/${path}`, document_id: document.id });
    }
    const files = await this.deps.files(context.userId, context.conversationId);
    for (const file of files.filter((entry) => entry.writable)) {
      signal.throwIfAborted();
      if (!file.asset_id || !file.revision_id) throw new Error("saved file has no Storage revision");
      const body = await this.deps.asset().content({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        assetId: file.asset_id,
        revisionId: file.revision_id,
        signal,
      });
      const path = `sources/saved/${file.path}`;
      try {
        await client.upload(id, scope, path, body, signal);
      } finally {
        if (!body.locked) await body.cancel().catch(() => {});
      }
      this.manifest.push({ path: `/workspace/${path}`, conversation_path: file.path });
    }
  }
  async load(context: ArtifactToolContext, signal?: AbortSignal) {
    const existed = Boolean(this.initializing);
    const session = await this.ensure(context, signal);
    if (existed) await this.hydrate(session.id, context);
    return { files: this.manifest };
  }
  async start(
    input: { command: string; workdir?: string; tty?: boolean; yield_time_ms?: number; timeout_ms?: number },
    context: ArtifactToolContext,
    requestId: string,
    signal?: AbortSignal,
  ) {
    const session = await this.ensure(context, signal);
    const result = await this.deps.sandbox().start(
      session.id,
      {
        workdir: "/workspace/work",
        tty: false,
        yield_time_ms: 1000,
        timeout_ms: 120000,
        ...input,
        scope: this.scope!,
        request_id: requestId,
      },
      signal,
    );
    this.processes.set(result.session_id, result);
    if (result.timed_out) await this.dispose();
    return result;
  }
  async write(
    input: { session_id: string; chars?: string; yield_time_ms?: number },
    context: ArtifactToolContext,
    requestId: string,
    signal?: AbortSignal,
  ) {
    this.bind(context, signal);
    const previous = this.processes.get(input.session_id);
    if (!previous) throw new Error("process session does not belong to this run");
    const session = await this.ensure(context, signal);
    const result = await this.deps.sandbox().write(
      session.id,
      input.session_id,
      {
        scope: this.scope!,
        request_id: requestId,
        chars: input.chars ?? "",
        yield_time_ms: input.yield_time_ms ?? 1000,
        stdout_offset: previous.stdout_offset,
        stderr_offset: previous.stderr_offset,
      },
      signal,
    );
    this.processes.set(result.session_id, result);
    if (result.timed_out) await this.dispose();
    return result;
  }
  async save(
    input: { path: string; filename: string; media_type: string; title: string },
    context: ArtifactToolContext,
    requestId: string,
    signal?: AbortSignal,
  ) {
    const session = await this.ensure(context, signal);
    const path = input.path.replace(/^\/workspace\//, "");
    const body = await this.deps.sandbox().download(session.id, this.scope!, path, signal);
    try {
      const asset = await this.deps.asset().upload({
        ...context,
        filename: input.filename,
        mediaType: input.media_type,
        category: "sandbox-artifact",
        body,
        idempotencyKey: `${context.runId}:${requestId}`,
        signal,
      });
      signal?.throwIfAborted();
      const document = await this.deps.publish({
        ...context,
        title: input.title,
        assetId: asset.assetId,
        revisionId: asset.revisionId,
        idempotencyKey: `${context.runId}:${requestId}`,
      });
      return {
        document_id: document.id,
        filename: document.filename,
        title: document.title,
        media_type: document.mime_type,
      };
    } finally {
      if (!body.locked) await body.cancel().catch(() => {});
    }
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.abort.abort();
    for (const [signal, listener] of this.stopListeners) signal.removeEventListener("abort", listener);
    this.stopListeners.clear();
    this.disposal = (async () => {
      await this.initializing?.catch(() => {});
      if (this.scope && this.initializing) await this.deps.sandbox().destroy(this.scope);
    })();
    return this.disposal;
  }
}
