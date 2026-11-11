import { randomBytes } from "node:crypto";

import type {
  KnowledgeDocument,
  SandboxInternalClient,
  SandboxProcess,
  SandboxScope,
  SandboxSession as SandboxResource,
  StorageInternalClient,
} from "@backend/transport-ts";
import type { Experimental_SandboxProcess, Experimental_SandboxSession } from "ai";

import { listDocuments } from "../../../../infrastructure/clients/knowledge.js";
import { sandboxClient } from "../../../../infrastructure/clients/sandbox.js";
import { storageClient } from "../../../../infrastructure/clients/storage.js";
import { logger } from "../../../../infrastructure/observability/logger.js";
import { listConversationFiles, publishConversationFile } from "../../../conversation-files.js";
import type { ArtifactToolContext } from "../context.js";

export interface SandboxDependencies {
  sandbox: () => Pick<
    SandboxInternalClient,
    "create" | "destroy" | "start" | "write" | "cancel" | "upload" | "download"
  >;
  asset: () => Pick<StorageInternalClient, "content" | "upload">;
  documents: typeof listDocuments;
  files: typeof listConversationFiles;
  publish: typeof publishConversationFile;
}

const defaults: SandboxDependencies = {
  sandbox: sandboxClient,
  asset: storageClient,
  documents: listDocuments,
  files: listConversationFiles,
  publish: publishConversationFile,
};

export function documentSandboxPath(document: Pick<KnowledgeDocument, "id" | "filename" | "source_filename">) {
  const name =
    (document.source_filename || document.filename).replace(/[^\p{L}\p{N}._-]/gu, "-").replace(/^\.+/, "") || "file";
  return `sources/documents/${encodeURIComponent(document.id)}/${name}`;
}

function savedFileSandboxPath(file: { id: string; filename: string }) {
  const name = file.filename.replace(/[^\p{L}\p{N}._-]/gu, "-").replace(/^\.+/, "") || "file";
  return `sources/saved/${encodeURIComponent(file.id)}/${name}`;
}

function appendProcessOutput(target: { stdout: string; stderr: string }, process: SandboxProcess) {
  target.stdout += process.stdout;
  target.stderr += process.stderr;
}

function sandboxRelativePath(path: string) {
  const relative = path.startsWith("/workspace/")
    ? path.slice("/workspace/".length)
    : `work/${path.replace(/^\.\//, "")}`;
  const segments = relative.split("/");
  if (!relative || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Sandbox file paths must stay within /workspace.");
  }
  return relative;
}

function writableSandboxPath(path: string) {
  const relative = sandboxRelativePath(path);
  if (!relative.startsWith("work/") && !relative.startsWith("outputs/")) {
    throw new Error("Sandbox writes are limited to /workspace/work and /workspace/outputs.");
  }
  return relative;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Run-scoped implementation of AI SDK 7's Experimental_SandboxSession.
 *
 * The installed SDK contract exposes command, file and process primitives.
 * File import and durable publication remain explicit Chat tools on this same
 * bound session; SDK writes can only target the temporary work/output trees.
 */
export class RunSandbox implements Experimental_SandboxSession {
  readonly description =
    "A run-scoped Linux sandbox rooted at /workspace. Commands start in /workspace/work; /workspace/outputs is writable and /workspace/sources contains read-only conversation snapshots. Files persist only for this run unless save_sandbox_file publishes one.";

  private initializing?: Promise<SandboxResource>;
  private refreshing?: Promise<Array<{ path: string; document_id?: string; file_id?: string }>>;
  private disposal?: Promise<void>;
  private closed = false;
  private readonly abort = new AbortController();
  private readonly stopListeners = new Map<AbortSignal, () => void>();
  private readonly sources = new Map<
    string,
    { fingerprint: string; source: { path: string; document_id?: string; file_id?: string } }
  >();
  private readonly scope: SandboxScope;

  constructor(
    private readonly context: ArtifactToolContext,
    private readonly deps: SandboxDependencies = defaults,
  ) {
    this.scope = {
      tenant_id: context.tenantId,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      conversation_id: context.conversationId,
      run_id: context.runId,
    };
  }

  private observeStop(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.closed) throw new Error("This run's sandbox is closed; temporary files are no longer available.");
    if (signal && !this.stopListeners.has(signal)) {
      const listener = () => {
        void this.dispose().catch((error) => logger.error({ err: error }, "sandbox stop cleanup failed"));
      };
      signal.addEventListener("abort", listener, { once: true });
      this.stopListeners.set(signal, listener);
    }
  }

  private operationSignal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([this.abort.signal, signal]) : this.abort.signal;
  }

  async ensure(signal?: AbortSignal) {
    this.observeStop(signal);
    this.initializing ??= (async () => {
      // Provisioning is bounded by the transport timeout. Finish observing create
      // before DELETE so Stop cannot race a late successful resource creation.
      const session = await this.deps.sandbox().create(this.scope);
      this.abort.signal.throwIfAborted();
      await this.hydrate(session.id);
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

  private async hydrate(id: string) {
    const signal = this.abort.signal;
    const client = this.deps.sandbox();
    const imported: Array<{ path: string; document_id?: string; file_id?: string }> = [];
    const documents = await this.deps.documents(this.context.userId, this.context.conversationId);
    for (const document of documents) {
      signal.throwIfAborted();
      if (
        document.user_id !== this.context.userId ||
        document.conversation_id !== this.context.conversationId ||
        (document.tenant_id != null && document.tenant_id !== this.context.tenantId) ||
        (document.workspace_id != null && document.workspace_id !== this.context.workspaceId)
      ) {
        throw new Error("conversation attachment scope mismatch");
      }
      if (!document.asset_id || !document.source_revision_id) throw new Error("attachment has no Storage revision");
      const path = documentSandboxPath(document);
      const source = { path: `/workspace/${path}`, document_id: document.id };
      const key = `document:${document.id}`;
      const fingerprint = `${document.asset_id}:${document.source_revision_id}:${path}`;
      if (this.sources.get(key)?.fingerprint === fingerprint) continue;
      const body = await this.deps.asset().content({
        tenantId: this.context.tenantId,
        workspaceId: this.context.workspaceId,
        assetId: document.asset_id,
        revisionId: document.source_revision_id,
        signal,
      });
      try {
        await client.upload(id, this.scope, path, body, signal);
      } finally {
        if (!body.locked) await body.cancel().catch(() => {});
      }
      this.sources.set(key, { fingerprint, source });
      imported.push(source);
    }

    const files = await this.deps.files({
      userId: this.context.userId,
      tenantId: this.context.tenantId,
      workspaceId: this.context.workspaceId,
      conversationId: this.context.conversationId,
    });
    for (const file of files) {
      signal.throwIfAborted();
      const path = savedFileSandboxPath(file);
      const source = { path: `/workspace/${path}`, file_id: file.id };
      const key = `file:${file.id}`;
      const fingerprint = `${file.asset_id}:${file.revision_id}:${path}`;
      if (this.sources.get(key)?.fingerprint === fingerprint) continue;
      const body = await this.deps.asset().content({
        tenantId: this.context.tenantId,
        workspaceId: this.context.workspaceId,
        assetId: file.asset_id,
        revisionId: file.revision_id,
        signal,
      });
      try {
        await client.upload(id, this.scope, path, body, signal);
      } finally {
        if (!body.locked) await body.cancel().catch(() => {});
      }
      this.sources.set(key, { fingerprint, source });
      imported.push(source);
    }
    return imported;
  }

  async refresh(signal?: AbortSignal) {
    const existed = Boolean(this.initializing);
    const session = await this.ensure(signal);
    const sources = existed
      ? await (this.refreshing ??= this.hydrate(session.id).finally(() => {
          this.refreshing = undefined;
        }))
      : [...this.sources.values()].map((entry) => entry.source);
    return { sources };
  }

  async run(options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const signal = this.operationSignal(options.abortSignal);
    const session = await this.ensure(options.abortSignal);
    const client = this.deps.sandbox();
    let process = await client.start(
      session.id,
      {
        command: options.command,
        workdir: options.workingDirectory ?? "/workspace/work",
        env: options.env ?? {},
        tty: false,
        yield_time_ms: 10_000,
        timeout_ms: 120_000,
        scope: this.scope,
        request_id: randomBytes(16).toString("hex"),
      },
      signal,
    );
    const output = { stdout: "", stderr: "" };
    appendProcessOutput(output, process);
    while (process.exitCode === null) {
      signal?.throwIfAborted();
      process = await client.write(
        session.id,
        process.session_id,
        {
          scope: this.scope,
          request_id: randomBytes(16).toString("hex"),
          chars: "",
          yield_time_ms: 10_000,
          stdout_offset: process.stdout_offset,
          stderr_offset: process.stderr_offset,
        },
        signal,
      );
      appendProcessOutput(output, process);
    }
    if (process.timed_out) await this.dispose();
    return { exitCode: process.exitCode, ...output };
  }

  async readFile(options: { path: string; abortSignal?: AbortSignal }) {
    const relative = sandboxRelativePath(options.path);
    const absolute = `/workspace/${relative}`;
    const check = await this.run({
      command: `test -f -- ${shellQuote(absolute)}`,
      workingDirectory: "/workspace/work",
      abortSignal: options.abortSignal,
    });
    if (check.exitCode === 1) return null;
    if (check.exitCode !== 0) throw new Error(check.stderr || `Could not inspect sandbox file ${absolute}.`);
    const session = await this.ensure(options.abortSignal);
    return this.deps.sandbox().download(session.id, this.scope, relative, this.operationSignal(options.abortSignal));
  }

  async readBinaryFile(options: { path: string; abortSignal?: AbortSignal }) {
    const body = await this.readFile(options);
    return body ? new Uint8Array(await new Response(body).arrayBuffer()) : null;
  }

  async readTextFile(options: {
    path: string;
    abortSignal?: AbortSignal;
    encoding?: string;
    startLine?: number;
    endLine?: number;
  }) {
    const bytes = await this.readBinaryFile(options);
    if (!bytes) return null;
    const text = new TextDecoder(options.encoding ?? "utf-8").decode(bytes);
    if (options.startLine === undefined && options.endLine === undefined) return text;
    const start = options.startLine ?? 1;
    const end = options.endLine ?? Number.POSITIVE_INFINITY;
    if (
      !Number.isInteger(start) ||
      start < 1 ||
      (!Number.isInteger(end) && end !== Number.POSITIVE_INFINITY) ||
      end < start
    ) {
      throw new RangeError("Sandbox text line ranges are 1-based and inclusive.");
    }
    return text
      .split("\n")
      .slice(start - 1, end)
      .join("\n");
  }

  async writeFile(options: { path: string; content: ReadableStream<Uint8Array>; abortSignal?: AbortSignal }) {
    const relative = writableSandboxPath(options.path);
    const session = await this.ensure(options.abortSignal);
    await this.deps
      .sandbox()
      .upload(session.id, this.scope, relative, options.content, this.operationSignal(options.abortSignal));
  }

  async writeBinaryFile(options: { path: string; content: Uint8Array; abortSignal?: AbortSignal }) {
    await this.writeFile({ ...options, content: new Blob([options.content]).stream() });
  }

  async writeTextFile(options: { path: string; content: string; abortSignal?: AbortSignal; encoding?: string }) {
    const encoding = (options.encoding ?? "utf-8").toLowerCase();
    if (encoding !== "utf-8" && encoding !== "utf8") {
      throw new Error(`Sandbox text writes do not support ${options.encoding} encoding.`);
    }
    await this.writeBinaryFile({ ...options, content: new TextEncoder().encode(options.content) });
  }

  async spawn(options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
    stdin?: boolean;
  }): Promise<Experimental_SandboxProcess & { stdin: WritableStream<Uint8Array> }> {
    if (options.stdin) {
      throw new Error("Writable process stdin is not supported by this sandbox transport.");
    }
    const session = await this.ensure(options.abortSignal);
    const signal = this.operationSignal(options.abortSignal);
    const client = this.deps.sandbox();
    let process = await client.start(
      session.id,
      {
        command: options.command,
        workdir: options.workingDirectory ?? "/workspace/work",
        env: options.env ?? {},
        tty: false,
        yield_time_ms: 0,
        timeout_ms: 120_000,
        scope: this.scope,
        request_id: randomBytes(16).toString("hex"),
      },
      signal,
    );
    const encoder = new TextEncoder();
    let stdoutController!: ReadableStreamDefaultController<Uint8Array>;
    let stderrController!: ReadableStreamDefaultController<Uint8Array>;
    let stdoutOpen = true;
    let stderrOpen = true;
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        stdoutController = controller;
      },
      cancel() {
        stdoutOpen = false;
      },
    });
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        stderrController = controller;
      },
      cancel() {
        stderrOpen = false;
      },
    });
    const enqueue = () => {
      if (stdoutOpen && process.stdout) stdoutController.enqueue(encoder.encode(process.stdout));
      if (stderrOpen && process.stderr) stderrController.enqueue(encoder.encode(process.stderr));
    };
    let resolveWait!: (value: { exitCode: number }) => void;
    let rejectWait!: (reason: unknown) => void;
    const completion = new Promise<{ exitCode: number }>((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
    });
    void (async () => {
      try {
        enqueue();
        while (process.exitCode === null) {
          process = await client.write(
            session.id,
            process.session_id,
            {
              scope: this.scope,
              request_id: randomBytes(16).toString("hex"),
              chars: "",
              yield_time_ms: 1_000,
              stdout_offset: process.stdout_offset,
              stderr_offset: process.stderr_offset,
            },
            signal,
          );
          enqueue();
        }
        if (process.timed_out) await this.dispose();
        if (stdoutOpen) stdoutController.close();
        if (stderrOpen) stderrController.close();
        resolveWait({ exitCode: process.exitCode });
      } catch (error) {
        if (stdoutOpen) stdoutController.error(error);
        if (stderrOpen) stderrController.error(error);
        rejectWait(error);
      }
    })();
    let killPromise: Promise<void> | undefined;
    return {
      stdout,
      stderr,
      wait: () => completion,
      kill: () =>
        (killPromise ??= (async () => {
          if (process.exitCode === null) await client.cancel(session.id, process.session_id, this.scope);
          await completion;
        })()),
      stdin: new WritableStream({
        write() {
          throw new Error("Writable process stdin was not enabled.");
        },
      }),
    };
  }

  async save(
    input: { path: string; filename: string; media_type: string; title: string },
    requestId: string,
    signal?: AbortSignal,
  ) {
    const session = await this.ensure(signal);
    if (!input.path.startsWith("/workspace/")) {
      throw new Error("Published files must use an absolute path under /workspace.");
    }
    const path = sandboxRelativePath(input.path);
    const body = await this.deps.sandbox().download(session.id, this.scope, path, this.operationSignal(signal));
    try {
      const asset = await this.deps.asset().upload({
        ...this.context,
        filename: input.filename,
        mediaType: input.media_type,
        category: "sandbox-artifact",
        body,
        idempotencyKey: `${this.context.runId}:${requestId}`,
        signal,
      });
      signal?.throwIfAborted();
      const file = await this.deps.publish({
        userId: this.context.userId,
        tenantId: this.context.tenantId,
        workspaceId: this.context.workspaceId,
        conversationId: this.context.conversationId,
        title: input.title,
        assetId: asset.assetId,
        revisionId: asset.revisionId,
        filename: asset.filename,
        mediaType: asset.mediaType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        idempotencyKey: `${this.context.runId}:${requestId}`,
      });
      return {
        file_id: file.id,
        filename: file.filename,
        title: file.title,
        media_type: file.mime_type,
        kind: file.kind,
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
      if (this.initializing) await this.deps.sandbox().destroy(this.scope);
    })();
    return this.disposal;
  }
}

export function requireRunSandbox(sandbox: Experimental_SandboxSession | undefined): RunSandbox {
  if (!(sandbox instanceof RunSandbox)) throw new Error("The run-scoped sandbox is not available.");
  return sandbox;
}
