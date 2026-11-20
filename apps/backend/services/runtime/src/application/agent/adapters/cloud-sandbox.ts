import { createHash, randomBytes } from "node:crypto";

import { workspaceMediaType } from "@repo/agent-runtime/protocol/artifact";
import { compilePermissionProfile, type PermissionProfile } from "@repo/agent-runtime/runtime/permissions";
import { ProcessManager } from "@repo/agent-runtime/runtime/process-manager";
import type {
  CommandOutputMetadata,
  SandboxAttempt,
  SandboxAttemptResult,
  SandboxViolation,
} from "@repo/agent-runtime/runtime/tool-orchestrator";
import type { Experimental_SandboxProcess, Experimental_SandboxSession } from "ai";

import type { SandboxProcess, SandboxSession as SandboxResource } from "#runtime/transport";

import {
  knowledgeDocumentSessionId,
  listDocuments,
  type KnowledgeDocument,
} from "../../../infrastructure/clients/knowledge.js";
import { sandboxClient } from "../../../infrastructure/clients/sandbox.js";
import type { RuntimeSandboxAdapter, SandboxScope } from "../../../infrastructure/clients/sandbox.js";
import { storageClient, type StorageClient } from "../../../infrastructure/clients/storage.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { isMissingSandboxResourceError, persistCloudWorkspace } from "../../cloud-workspace.js";
import {
  deleteWorkspaceSessionFile,
  listSessionFiles,
  publishSessionFile,
  saveSessionFile,
  type SessionFile,
} from "../../session-files.js";
import { isValidWorkspacePath } from "../../workspace-paths.js";
import { sandboxExecutionLifecycle, type SandboxExecutionLifecycle } from "../runs/sandbox-executions.js";
import type { ArtifactToolContext } from "../tools/context.js";

export interface SandboxDependencies {
  sandbox: () => Pick<
    RuntimeSandboxAdapter,
    "create" | "destroy" | "start" | "write" | "cancel" | "upload" | "download" | "deleteFile" | "snapshot"
  >;
  asset: () => Pick<StorageClient, "content" | "upload" | "appendRevision" | "prepareClaim" | "activateClaim">;
  documents: typeof listDocuments;
  files: typeof listSessionFiles;
  publish: typeof publishSessionFile;
  update: typeof saveSessionFile;
  delete: typeof deleteWorkspaceSessionFile;
  execution: SandboxExecutionLifecycle;
}

const defaults: SandboxDependencies = {
  sandbox: sandboxClient,
  asset: storageClient,
  documents: listDocuments,
  files: listSessionFiles,
  publish: publishSessionFile,
  update: saveSessionFile,
  delete: deleteWorkspaceSessionFile,
  execution: sandboxExecutionLifecycle,
};

export function documentSandboxPath(document: Pick<KnowledgeDocument, "id" | "filename" | "source_filename">) {
  const name =
    (document.source_filename || document.filename).replace(/[^\p{L}\p{N}._-]/gu, "-").replace(/^\.+/, "") || "file";
  return `sources/documents/${encodeURIComponent(document.id)}/${name}`;
}

function appendProcessOutput(
  target: { stdout: string; stderr: string; outputMetadata: CommandOutputMetadata },
  process: SandboxProcess,
) {
  const retention = process as SandboxProcess & { stdout_truncated?: boolean; stderr_truncated?: boolean };
  target.stdout += process.stdout;
  target.stderr += process.stderr;
  target.outputMetadata.stdout.totalBytes = process.stdout_offset;
  target.outputMetadata.stderr.totalBytes = process.stderr_offset;
  target.outputMetadata.stdout.truncated ||= retention.stdout_truncated ?? process.truncated;
  target.outputMetadata.stderr.truncated ||= retention.stderr_truncated ?? process.truncated;
}

function transportSandboxAttempt(attempt: SandboxAttempt) {
  return {
    attempt: attempt.attempt,
    sandboxed: attempt.sandboxed,
    permission_profile:
      attempt.permissionProfile.type === "managed"
        ? {
            type: "managed" as const,
            file_system:
              attempt.permissionProfile.fileSystem.type === "unrestricted"
                ? { type: "unrestricted" as const }
                : {
                    type: "restricted" as const,
                    entries: attempt.permissionProfile.fileSystem.entries.map((entry) => ({ ...entry })),
                  },
            network:
              attempt.permissionProfile.network.type === "enabled"
                ? { type: "enabled" as const }
                : {
                    type: "restricted" as const,
                    allowed_hosts: [...attempt.permissionProfile.network.allowedHosts],
                  },
          }
        : attempt.permissionProfile.type === "external"
          ? {
              type: "external" as const,
              network:
                attempt.permissionProfile.network.type === "enabled"
                  ? { type: "enabled" as const }
                  : {
                      type: "restricted" as const,
                      allowed_hosts: [...attempt.permissionProfile.network.allowedHosts],
                    },
            }
          : { type: "disabled" as const },
    process: { process_id: attempt.process.processId, entry_id: attempt.process.entryId },
  };
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
  if (
    relative === ".home" ||
    relative.startsWith(".home/") ||
    relative === "sources" ||
    relative.startsWith("sources/")
  ) {
    throw new Error("Sandbox writes cannot target runtime state or imported sources.");
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
 * Chat restores and finalizes the stable business tree around the SDK-owned
 * command/file primitives; deliverable publication remains a product action.
 */
export class RunSandbox implements Experimental_SandboxSession {
  readonly description =
    "A run-scoped Linux sandbox rooted at the session's stable /workspace tree. Business files are restored at their authoritative paths and automatically persisted before teardown; /workspace/sources contains read-only external attachments.";

  private initializing?: Promise<SandboxResource>;
  private session?: SandboxResource;
  private refreshing?: Promise<Array<{ path: string; document_id?: string; file_id?: string }>>;
  private disposal?: Promise<void>;
  private closed = false;
  private readonly abort = new AbortController();
  private readonly ownerStopListener?: () => void;
  private readonly sources = new Map<
    string,
    { fingerprint: string; source: { path: string; document_id?: string; file_id?: string } }
  >();
  private readonly workspaceBaseline = new Map<string, SessionFile>();
  private readonly observedFileEtags = new Map<string, string>();
  private fileObservationInitialized = false;
  private sourceManifest = "";
  private readonly scope: SandboxScope;
  constructor(
    private readonly context: ArtifactToolContext & { attemptEpoch: string },
    private readonly deps: SandboxDependencies = defaults,
    private readonly ownerSignal?: AbortSignal,
    private readonly helperPermissionProfile: PermissionProfile = compilePermissionProfile(":workspace", {
      workspaceRoot: "/workspace",
    }).profile,
    private readonly helperProcesses: ProcessManager<{ terminate(): void }> = new ProcessManager(),
  ) {
    this.scope = {
      tenant_id: context.tenantId,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      session_id: context.sessionId,
      run_id: context.runId,
      attempt_epoch: context.attemptEpoch,
    };
    if (ownerSignal) {
      // The Turn owns workspace teardown. ProcessManager signals are operation-scoped
      // and may abort after an ordinary tool failure without ending the Turn.
      this.ownerStopListener = () => {
        this.abort.abort(ownerSignal.reason);
        void this.dispose().catch((error) => logger.error({ err: error }, "sandbox stop cleanup failed"));
      };
      if (ownerSignal.aborted) this.ownerStopListener();
      else ownerSignal.addEventListener("abort", this.ownerStopListener, { once: true });
    }
  }

  private observeStop(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.closed) throw new Error("This run's sandbox is closed; the workspace is no longer attached.");
  }

  private operationSignal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([this.abort.signal, signal]) : this.abort.signal;
  }

  async ensure(signal?: AbortSignal) {
    this.observeStop(signal);
    this.initializing ??= (async () => {
      // Provisioning is bounded by the transport timeout. Finish observing create
      // before DELETE so Stop cannot race a late successful resource creation.
      await this.deps.execution.restoring(this.scope);
      const session = await this.deps.sandbox().create(this.scope);
      this.abort.signal.throwIfAborted();
      await this.hydrate(session.id);
      await this.deps.execution.active(this.scope, session);
      this.session = session;
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
    const documents = await this.deps.documents(this.context.userId, this.context.sessionId);
    for (const document of documents) {
      signal.throwIfAborted();
      if (
        document.user_id !== this.context.userId ||
        knowledgeDocumentSessionId(document) !== this.context.sessionId ||
        (document.tenant_id != null && document.tenant_id !== this.context.tenantId) ||
        (document.workspace_id != null && document.workspace_id !== this.context.workspaceId)
      ) {
        throw new Error("session attachment scope mismatch");
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
      sessionId: this.context.sessionId,
    });
    for (const file of files) {
      signal.throwIfAborted();
      const path = sandboxRelativePath(file.workspace_path);
      const source = { path: file.workspace_path, file_id: file.id };
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
      this.workspaceBaseline.set(file.workspace_path, file);
      imported.push(source);
    }
    const manifest = `${JSON.stringify(
      {
        version: 1,
        files: files.map((file) => ({
          file_id: file.id,
          path: file.workspace_path,
          etag: file.etag,
          revision_id: file.revision_id,
          editable: file.editable,
        })),
      },
      null,
      2,
    )}\n`;
    if (files.length > 0 && manifest !== this.sourceManifest) {
      await client.upload(id, this.scope, "sources/workspace-manifest.json", new Blob([manifest]).stream(), signal);
      this.sourceManifest = manifest;
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

  async observeWorkspaceBaseline(): Promise<void> {
    const files = await this.deps.files({
      userId: this.context.userId,
      tenantId: this.context.tenantId,
      workspaceId: this.context.workspaceId,
      sessionId: this.context.sessionId,
    });
    this.observedFileEtags.clear();
    for (const file of files) this.observedFileEtags.set(file.id, file.etag);
    this.fileObservationInitialized = true;
  }

  async consumeExternalFileChanges(): Promise<Array<{ path: string; writer: string | null }>> {
    const files = await this.deps.files({
      userId: this.context.userId,
      tenantId: this.context.tenantId,
      workspaceId: this.context.workspaceId,
      sessionId: this.context.sessionId,
    });
    if (!this.fileObservationInitialized) {
      await this.observeWorkspaceBaseline();
      return [];
    }
    const changes = files
      .filter(
        (file) =>
          this.observedFileEtags.get(file.id) !== file.etag &&
          file.last_writer.type === "user" &&
          file.last_writer.id !== this.context.runId,
      )
      .map((file) => ({ path: file.workspace_path, writer: file.last_writer.id }));
    this.observedFileEtags.clear();
    for (const file of files) this.observedFileEtags.set(file.id, file.etag);
    return changes;
  }

  async runAttempt(
    attempt: SandboxAttempt,
    options: {
      command: string;
      workingDirectory?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      abortSignal?: AbortSignal;
      violationHint?: SandboxViolation;
    },
  ): Promise<SandboxAttemptResult> {
    const attemptSignal = options.abortSignal
      ? AbortSignal.any([attempt.abortSignal, options.abortSignal])
      : attempt.abortSignal;
    const signal = this.operationSignal(attemptSignal);
    const session = await this.ensure(attemptSignal);
    const client = this.deps.sandbox();
    let process = await client.start(
      session.id,
      {
        command: options.command,
        workdir: options.workingDirectory ?? "/workspace/work",
        env: options.env ?? {},
        tty: false,
        yield_time_ms: 10_000,
        timeout_ms: options.timeoutMs ?? 120_000,
        scope: this.scope,
        request_id: randomBytes(16).toString("hex"),
        sandbox: transportSandboxAttempt(attempt),
        ...(options.violationHint ? { violation_hint: options.violationHint } : {}),
      },
      signal,
    );
    const output = {
      stdout: "",
      stderr: "",
      outputMetadata: {
        stdout: { totalBytes: 0, truncated: false },
        stderr: { totalBytes: 0, truncated: false },
      },
    };
    appendProcessOutput(output, process);
    while (process.termination === null) {
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
    const termination = process.termination;
    switch (termination.type) {
      case "exit":
        return { type: "exit", exitCode: termination.exit_code, ...output };
      case "timeout":
        return { type: "timeout", timeoutMs: termination.timeout_ms, ...output };
      case "start-error":
        return { type: "start-error", message: termination.message, ...output };
      case "sandbox-unavailable":
        return { type: "sandbox-unavailable", message: termination.message, ...output };
      case "sandbox-violation":
        return { type: "sandbox-violation", violation: termination.violation, ...output };
    }
    throw new Error("Sandbox returned an unknown process termination.");
  }

  private async runHelper(options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.helperProcesses.run(async (identity, abortSignal) => {
      const result = await this.runAttempt(
        {
          attempt: 1,
          sandboxed: this.helperPermissionProfile.type !== "disabled",
          permissionProfile: this.helperPermissionProfile,
          process: identity,
          abortSignal,
        },
        options,
      );
      switch (result.type) {
        case "exit":
          return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
        case "timeout":
          return { exitCode: 124, stdout: result.stdout, stderr: result.stderr };
        case "sandbox-violation":
          throw new Error(result.stderr || "Sandbox helper was denied by its permission profile.");
        case "sandbox-unavailable":
        case "start-error":
          throw new Error(result.message);
      }
      throw new Error("Sandbox helper returned an unknown process result.");
    });
  }

  run(options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.runHelper(options);
  }

  async readFile(options: { path: string; abortSignal?: AbortSignal }) {
    const relative = sandboxRelativePath(options.path);
    const absolute = `/workspace/${relative}`;
    const check = await this.runHelper({
      command: `test -f ${shellQuote(absolute)}`,
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

  async readTextSnapshot(options: { path: string; abortSignal?: AbortSignal }) {
    const bytes = await this.readBinaryFile(options);
    if (!bytes) return null;
    if (bytes.byteLength > 2 * 1024 * 1024) {
      throw new Error("Text file exceeds the 2 MiB direct-edit limit; use a bounded Bash command instead.");
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      const error = new Error("File is not valid UTF-8 text; use Bash or a binary-aware tool instead.");
      Object.assign(error, { code: "FILE_NOT_TEXT" });
      throw error;
    }
    if (content.includes("\0")) {
      const error = new Error("File contains null bytes and is not supported by direct text tools.");
      Object.assign(error, { code: "FILE_NOT_TEXT" });
      throw error;
    }
    return {
      content,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    };
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

  async writeTextFileConditional(options: {
    path: string;
    content: string;
    mode: "create" | "overwrite";
    expectedSha256?: string;
    abortSignal?: AbortSignal;
  }) {
    const bytes = new TextEncoder().encode(options.content);
    if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("File content exceeds the 2 MiB direct-edit limit.");
    const relative = writableSandboxPath(options.path);
    const session = await this.ensure(options.abortSignal);
    await this.deps
      .sandbox()
      .upload(
        session.id,
        this.scope,
        relative,
        new Blob([bytes]).stream(),
        this.operationSignal(options.abortSignal),
        undefined,
        { mode: options.mode, ...(options.expectedSha256 ? { expectedSha256: options.expectedSha256 } : {}) },
      );
    return {
      path: `/workspace/${relative}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
      created: options.mode === "create",
    };
  }

  async deleteTextFile(options: { path: string; expectedSha256: string; abortSignal?: AbortSignal }) {
    const relative = writableSandboxPath(options.path);
    const session = await this.ensure(options.abortSignal);
    await this.deps
      .sandbox()
      .deleteFile(session.id, this.scope, relative, options.expectedSha256, this.operationSignal(options.abortSignal));
  }

  async stat(options: {
    path: string;
    abortSignal?: AbortSignal;
  }): Promise<{ type: "file" | "directory" | "other"; size: number } | null> {
    const absolute = `/workspace/${sandboxRelativePath(options.path)}`;
    const result = await this.runHelper({
      command: `if [ ! -e ${shellQuote(absolute)} ]; then exit 44; fi
if [ -f ${shellQuote(absolute)} ]; then kind=file
elif [ -d ${shellQuote(absolute)} ]; then kind=directory
else kind=other
fi
printf '%s\\n' "$kind"
stat -Lc '%s' -- ${shellQuote(absolute)}`,
      workingDirectory: "/workspace/work",
      abortSignal: options.abortSignal,
    });
    if (result.exitCode === 44) return null;
    if (result.exitCode !== 0) throw new Error(result.stderr || `Could not inspect sandbox path ${absolute}.`);
    const [type, sizeText] = result.stdout.trimEnd().split("\n");
    const size = Number(sizeText);
    if ((type !== "file" && type !== "directory" && type !== "other") || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Sandbox returned invalid stat data for ${absolute}.`);
    }
    return { type, size };
  }

  async listDirectory(options: { path: string; abortSignal?: AbortSignal }) {
    const absolute = `/workspace/${sandboxRelativePath(options.path)}`;
    const result = await this.runHelper({
      command: `if [ ! -e ${shellQuote(absolute)} ]; then exit 44; fi
if [ ! -d ${shellQuote(absolute)} ]; then exit 45; fi
find -H ${shellQuote(absolute)} -mindepth 1 -maxdepth 1 -printf '%f\\0%y\\0'`,
      workingDirectory: "/workspace/work",
      abortSignal: options.abortSignal,
    });
    if (result.exitCode === 44) return null;
    if (result.exitCode === 45) throw new Error(`Sandbox path is not a directory: ${absolute}.`);
    if (result.exitCode !== 0) throw new Error(result.stderr || `Could not list sandbox directory ${absolute}.`);
    const fields = result.stdout.split("\0");
    if (fields.at(-1) === "") fields.pop();
    if (fields.length % 2 !== 0) throw new Error(`Sandbox returned an invalid directory listing for ${absolute}.`);
    const entries: Array<{ name: string; type: "file" | "directory" | "symlink" | "other" }> = [];
    for (let index = 0; index < fields.length; index += 2) {
      const name = fields[index]!;
      const kind = fields[index + 1]!;
      entries.push({
        name,
        type: kind === "f" ? "file" : kind === "d" ? "directory" : kind === "l" ? "symlink" : "other",
      });
    }
    return entries;
  }

  async deleteFile(options: { path: string; abortSignal?: AbortSignal }) {
    const absolute = `/workspace/${writableSandboxPath(options.path)}`;
    const result = await this.runHelper({
      command: `if [ -d ${shellQuote(absolute)} ] && [ ! -L ${shellQuote(absolute)} ]; then exit 45; fi
if [ ! -e ${shellQuote(absolute)} ] && [ ! -L ${shellQuote(absolute)} ]; then exit 44; fi
rm -- ${shellQuote(absolute)}`,
      workingDirectory: "/workspace/work",
      abortSignal: options.abortSignal,
    });
    if (result.exitCode === 44) return false;
    if (result.exitCode === 45) throw new Error(`Sandbox path is a directory: ${absolute}.`);
    if (result.exitCode !== 0) throw new Error(result.stderr || `Could not delete sandbox file ${absolute}.`);
    return true;
  }

  async stagePublishedFile(path: string, content: Uint8Array, signal?: AbortSignal): Promise<boolean> {
    if (!this.session) return false;
    const workspacePath = path.startsWith("/workspace/") ? path : `/workspace/${path}`;
    if (this.workspaceBaseline.has(workspacePath)) {
      throw new Error(`A workspace file already exists at ${workspacePath}.`);
    }
    await this.writeBinaryFile({ path: workspacePath, content, abortSignal: signal });
    return true;
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
    const identity = this.helperProcesses.reserve();
    const controller = new AbortController();
    this.helperProcesses.markRunning(identity, { terminate: () => controller.abort(new Error("process closed")) });
    const attempt: SandboxAttempt = {
      attempt: 1,
      sandboxed: this.helperPermissionProfile.type !== "disabled",
      permissionProfile: this.helperPermissionProfile,
      process: identity,
      abortSignal: controller.signal,
    };
    const session = await this.ensure(options.abortSignal);
    const helperSignal = options.abortSignal
      ? AbortSignal.any([controller.signal, options.abortSignal])
      : controller.signal;
    const signal = this.operationSignal(helperSignal);
    const client = this.deps.sandbox();
    let process: SandboxProcess;
    try {
      process = await client.start(
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
          sandbox: transportSandboxAttempt(attempt),
        },
        signal,
      );
    } catch (error) {
      this.helperProcesses.close(identity);
      throw error;
    }
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
        while (process.termination === null) {
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
        const termination = process.termination;
        if (termination.type === "timeout") await this.dispose();
        if (stdoutOpen) stdoutController.close();
        if (stderrOpen) stderrController.close();
        if (termination.type === "exit") resolveWait({ exitCode: termination.exit_code });
        else if (termination.type === "timeout") resolveWait({ exitCode: 124 });
        else
          rejectWait(
            new Error(termination.type === "sandbox-violation" ? "Sandbox process was denied." : termination.message),
          );
      } catch (error) {
        if (stdoutOpen) stdoutController.error(error);
        if (stderrOpen) stderrController.error(error);
        rejectWait(error);
      } finally {
        if (this.helperProcesses.contains(identity)) {
          try {
            this.helperProcesses.markExited(identity);
          } finally {
            this.helperProcesses.close(identity);
          }
        }
      }
    })();
    let killPromise: Promise<void> | undefined;
    return {
      stdout,
      stderr,
      wait: () => completion,
      kill: () =>
        (killPromise ??= (async () => {
          if (process.termination === null) await client.cancel(session.id, process.session_id, this.scope);
          await completion;
        })()),
      stdin: new WritableStream({
        write() {
          throw new Error("Writable process stdin was not enabled.");
        },
      }),
    };
  }

  async save(candidate: string, requestId: string, signal?: AbortSignal) {
    const path = writableSandboxPath(candidate);
    const workspacePath = `/workspace/${path}`;
    if (!isValidWorkspacePath(workspacePath)) throw new Error("Invalid workspace file path.");
    const session = await this.ensure(signal);
    const baseline = this.workspaceBaseline.get(workspacePath);
    const filename = path.split("/").at(-1)!;
    if (baseline) {
      const firstBody = await this.deps.sandbox().download(session.id, this.scope, path, this.operationSignal(signal));
      const hash = createHash("sha256");
      const reader = firstBody.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          hash.update(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        if (!firstBody.locked) await firstBody.cancel().catch(() => {});
      }
      const file = await this.deps.update(
        {
          userId: this.context.userId,
          tenantId: this.context.tenantId,
          workspaceId: this.context.workspaceId,
          sessionId: this.context.sessionId,
          fileId: baseline.id,
          expectedEtag: baseline.etag,
          workspacePath,
          expectedPathGeneration: baseline.path_generation,
          contentSha256: hash.digest("hex"),
          operationId: createHash("sha256").update(`${this.context.runId}:${requestId}`).digest("hex"),
          writerType: "agent",
          writerId: this.context.runId,
        },
        async (idempotencyKey, current, claim) => {
          const storage = this.deps.asset();
          const claimInput = {
            tenantId: this.context.tenantId,
            workspaceId: this.context.workspaceId,
            ...claim,
          };
          await storage.prepareClaim({
            ...claimInput,
            assetId: current.asset_id,
            revisionId: current.revision_id,
            kind: "strong",
          });
          await storage.activateClaim(claimInput);
          const body = await this.deps.sandbox().download(session.id, this.scope, path, this.operationSignal(signal));
          try {
            return await storage.appendRevision({
              ...this.context,
              assetId: current.asset_id,
              baseRevisionId: current.revision_id,
              ...claim,
              filename: current.filename,
              mediaType: current.mime_type,
              body,
              idempotencyKey,
              signal,
            });
          } finally {
            if (!body.locked) await body.cancel().catch(() => {});
          }
        },
      );
      this.workspaceBaseline.set(workspacePath, file);
      return {
        file_id: file.id,
        workspace_path: workspacePath,
        filename: file.filename,
        title: file.title,
        media_type: file.mime_type,
        kind: "artifact",
        etag: file.etag,
        updated: true,
      };
    }
    const body = await this.deps.sandbox().download(session.id, this.scope, path, this.operationSignal(signal));
    try {
      const asset = await this.deps.asset().upload({
        ...this.context,
        filename,
        mediaType: workspaceMediaType(filename),
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
        sessionId: this.context.sessionId,
        title: filename,
        assetId: asset.assetId,
        revisionId: asset.revisionId,
        filename: asset.filename,
        mediaType: asset.mediaType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        idempotencyKey: `${this.context.runId}:${requestId}`,
        workspacePath,
        writerType: "agent",
        writerId: this.context.runId,
      });
      this.workspaceBaseline.set(workspacePath, file);
      return {
        file_id: file.id,
        workspace_path: workspacePath,
        filename: file.filename,
        title: file.title,
        media_type: file.mime_type,
        kind: "artifact",
        etag: file.etag,
        updated: false,
      };
    } finally {
      if (!body.locked) await body.cancel().catch(() => {});
    }
  }

  private async persistWorkspace(session: SandboxResource): Promise<void> {
    await persistCloudWorkspace(this.context, session.id, this.deps);
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.helperProcesses.closeAll();
    this.abort.abort();
    if (this.ownerStopListener) this.ownerSignal?.removeEventListener("abort", this.ownerStopListener);
    this.disposal = (async () => {
      await this.initializing?.catch(() => {});
      if (this.initializing) {
        let persistenceError: unknown;
        if (this.session) {
          try {
            await this.deps.execution.finalizing(this.scope);
            await this.persistWorkspace(this.session);
          } catch (error) {
            persistenceError = error;
          }
        }
        if (persistenceError) {
          if (isMissingSandboxResourceError(persistenceError)) {
            await this.deps.execution.releasing(this.scope, persistenceError);
            try {
              await this.deps.sandbox().destroy(this.scope);
            } catch (error) {
              if (!isMissingSandboxResourceError(error)) {
                await this.deps.execution.releasing(this.scope, error).catch(() => {});
                throw persistenceError;
              }
            }
            await this.deps.execution.released(this.scope);
            throw persistenceError;
          }
          await this.deps.execution.finalizationFailed(this.scope, persistenceError).catch(() => {});
          throw persistenceError;
        }
        await this.deps.execution.releasing(this.scope);
        try {
          await this.deps.sandbox().destroy(this.scope);
          await this.deps.execution.released(this.scope);
        } catch (error) {
          await this.deps.execution.releasing(this.scope, error).catch(() => {});
          throw error;
        }
      }
    })();
    return this.disposal;
  }
}

export function requireRunSandbox(sandbox: Experimental_SandboxSession | undefined): RunSandbox {
  if (!(sandbox instanceof RunSandbox)) throw new Error("The run-scoped sandbox is not available.");
  return sandbox;
}
