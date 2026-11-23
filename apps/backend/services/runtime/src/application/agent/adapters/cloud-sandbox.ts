import { createHash, randomBytes } from "node:crypto";

import {
  type CommandOutputMetadata,
  type SandboxAttempt,
  type SandboxAttemptResult,
  type SandboxViolation,
  type ProcessIO,
  ProcessManager,
  workspaceMediaType,
  compilePermissionProfile,
  type PermissionProfile,
  permissionProfileFileAccess,
} from "@repo/agent-runtime";
import type { Experimental_SandboxProcess, Experimental_SandboxSession } from "ai";

import type { SandboxProcess } from "#runtime/transport";

import { sandboxClient } from "../../../infrastructure/clients/sandbox.js";
import type { RuntimeSandboxAdapter, SandboxScope } from "../../../infrastructure/clients/sandbox.js";
import { storageClient, type StorageClient } from "../../../infrastructure/clients/storage.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { persistCloudWorkspace } from "../../cloud-workspace.js";
import {
  deleteWorkspaceSessionFile,
  listSessionFiles,
  publishSessionFile,
  saveSessionFile,
  type SessionFile,
} from "../../session-files.js";
import { readWorkspaceCheckout, recordWorkspaceCheckout } from "../../workspace-checkout.js";
import { ATTACHMENT_ROOT, isValidWorkspacePath } from "../../workspace-paths.js";
import { sandboxExecutionLifecycle, type SandboxExecutionLifecycle } from "../runs/sandbox-executions.js";
import type { ArtifactToolContext } from "../tools/context.js";
import { SandboxLease } from "./sandbox-lease.js";

type SpawnOptions = Parameters<Experimental_SandboxSession["spawn"]>[0];
type WritableProcess = Experimental_SandboxProcess & { stdin: WritableStream<Uint8Array> };

export interface SandboxDependencies {
  sandbox: () => Pick<
    RuntimeSandboxAdapter,
    "create" | "destroy" | "start" | "write" | "cancel" | "upload" | "download" | "deleteFile" | "snapshot"
  >;
  asset: () => Pick<StorageClient, "content" | "upload" | "appendRevision" | "prepareClaim" | "activateClaim">;
  files: typeof listSessionFiles;
  checkout: typeof readWorkspaceCheckout;
  recordCheckout: typeof recordWorkspaceCheckout;
  publish: typeof publishSessionFile;
  update: typeof saveSessionFile;
  delete: typeof deleteWorkspaceSessionFile;
  execution: SandboxExecutionLifecycle;
}

const defaults: SandboxDependencies = {
  sandbox: sandboxClient,
  asset: storageClient,
  files: listSessionFiles,
  checkout: readWorkspaceCheckout,
  recordCheckout: recordWorkspaceCheckout,
  publish: publishSessionFile,
  update: saveSessionFile,
  delete: deleteWorkspaceSessionFile,
  execution: sandboxExecutionLifecycle,
};

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
 * Runtime restores and finalizes the session workspace around the SDK-owned
 * command/file primitives; deliverable publication remains a product action.
 */
export class RunSandbox implements Experimental_SandboxSession {
  readonly description =
    "A run-scoped Linux sandbox rooted at the session's stable /workspace tree. Business files are restored at their authoritative paths and automatically persisted before teardown; /workspace/sources contains read-only external attachments.";

  private readonly lease: SandboxLease;
  private refreshing?: Promise<Array<{ path: string; document_id?: string; file_id?: string }>>;
  private readonly sources = new Map<
    string,
    { fingerprint: string; source: { path: string; document_id?: string; file_id?: string } }
  >();
  private readonly observedFileEtags = new Map<string, string>();
  private fileObservationInitialized = false;
  private sourceManifest = "";
  private readonly scope: SandboxScope;
  constructor(
    private readonly context: ArtifactToolContext & { attemptEpoch: string },
    private readonly deps: SandboxDependencies = defaults,
    ownerSignal?: AbortSignal,
    private readonly helperPermissionProfile: PermissionProfile = compilePermissionProfile(":workspace", {
      workspaceRoot: "/workspace",
    }).profile,
    private readonly helperProcesses: ProcessManager = new ProcessManager(),
  ) {
    this.scope = {
      session_id: context.sessionId,
      run_id: context.runId,
      attempt_epoch: context.attemptEpoch,
    };
    this.lease = new SandboxLease({
      scope: this.scope,
      client: deps.sandbox,
      journal: deps.execution,
      restore: (id) => this.hydrate(id),
      persist: (id) => persistCloudWorkspace(this.context, id, this.deps),
      stopProcesses: () => this.helperProcesses.closeAll(),
      owner: ownerSignal,
    });
  }

  private operationSignal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([this.lease.signal, signal]) : this.lease.signal;
  }

  ensure(signal?: AbortSignal) {
    return this.lease.open(signal);
  }

  private async hydrate(id: string) {
    const signal = this.lease.signal;
    const client = this.deps.sandbox();
    const imported: Array<{ path: string; document_id?: string; file_id?: string }> = [];
    const files = await this.deps.files({
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
      if (!file.workspace_path.startsWith(ATTACHMENT_ROOT)) {
        await this.deps.recordCheckout(this.context, file);
      }
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
    const existed = this.lease.started;
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
      sessionId: this.context.sessionId,
    });
    this.observedFileEtags.clear();
    for (const file of files) this.observedFileEtags.set(file.id, file.etag);
    this.fileObservationInitialized = true;
  }

  async consumeExternalFileChanges(): Promise<Array<{ path: string; writer: string | null }>> {
    const files = await this.deps.files({
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
      shell?: string;
      login?: boolean;
      io?: ProcessIO;
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
        command:
          options.shell || options.login
            ? `exec ${shellQuote(options.shell ?? "/bin/bash")} ${options.login ? "-lc" : "-c"} ${shellQuote(options.command)}`
            : options.command,
        workdir: options.workingDirectory ?? "/workspace/work",
        env: options.env ?? {},
        tty: options.io?.tty ?? false,
        retain_output: Boolean(options.io),
        yield_time_ms: options.io ? 0 : 10_000,
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
    const capture = (chunk: SandboxProcess) => {
      if (options.io) {
        if (chunk.retained_output_path) options.io.retainOutput({ path: chunk.retained_output_path });
        options.io.output(chunk.stdout + chunk.stderr);
      } else appendProcessOutput(output, chunk);
    };
    capture(process);
    const processId = process.session_id;
    if (options.io?.tty)
      options.io.stdin(async (chars, requestId) => {
        signal.throwIfAborted();
        await client.write(
          session.id,
          processId,
          {
            scope: this.scope,
            request_id: requestId,
            chars,
            yield_time_ms: 0,
            stdout_offset: process.stdout_offset,
            stderr_offset: process.stderr_offset,
          },
          signal,
        );
      });
    try {
      while (process.termination === null) {
        signal?.throwIfAborted();
        process = await client.write(
          session.id,
          process.session_id,
          {
            scope: this.scope,
            request_id: randomBytes(16).toString("hex"),
            chars: "",
            yield_time_ms: options.io ? 250 : 10_000,
            stdout_offset: process.stdout_offset,
            stderr_offset: process.stderr_offset,
          },
          signal,
        );
        capture(process);
      }
    } finally {
      if (process.termination === null) await client.cancel(session.id, processId, this.scope);
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

  private checkFileAccess(relative: string, access: "read" | "write") {
    const path = `/workspace/${relative}`;
    if (permissionProfileFileAccess(this.helperPermissionProfile, { path, access }) !== "allowed") {
      throw new Error(`The active permission profile does not grant ${access} access to ${path}.`);
    }
  }

  async readFile(options: { path: string; abortSignal?: AbortSignal }) {
    const relative = sandboxRelativePath(options.path);
    this.checkFileAccess(relative, "read");
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
    this.checkFileAccess(relative, "write");
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
      const name = fields[index];
      const kind = fields[index + 1];
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

  async stagePublishedFile(file: SessionFile, content: Uint8Array, signal?: AbortSignal): Promise<void> {
    if (!this.lease.attached) return;
    const relative = writableSandboxPath(file.workspace_path);
    const session = await this.ensure(signal);
    const client = this.deps.sandbox();
    const active = this.operationSignal(signal);
    try {
      await client.upload(session.id, this.scope, relative, new Blob([content]).stream(), active, undefined, {
        mode: "create",
      });
    } catch (error) {
      active.throwIfAborted();
      // A repeated create or lost upload acknowledgement may leave exactly these bytes in place.
      const actual = await this.fileDigest(session.id, relative, active).catch(() => null);
      if (actual !== file.sha256) throw error;
    }
    await this.deps.recordCheckout(this.context, file);
  }

  private async fileDigest(id: string, path: string, signal: AbortSignal) {
    const body = await this.deps.sandbox().download(id, this.scope, path, signal);
    const hash = createHash("sha256");
    for await (const chunk of body) hash.update(chunk);
    return hash.digest("hex");
  }

  spawn(options: SpawnOptions & { stdin: true }): Promise<WritableProcess>;
  spawn(options: SpawnOptions): Promise<Experimental_SandboxProcess>;
  async spawn(options: SpawnOptions): Promise<Experimental_SandboxProcess | WritableProcess> {
    const session = await this.ensure(options.abortSignal);
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
          binary_io: true,
          pipe_stdin: options.stdin === true,
          yield_time_ms: 0,
          timeout_ms: 120_000,
          scope: this.scope,
          request_id: randomBytes(16).toString("hex"),
          sandbox: transportSandboxAttempt(attempt),
        },
        signal,
      );
    } catch (error) {
      if (this.helperProcesses.contains(identity)) this.helperProcesses.close(identity);
      throw error;
    }
    const processId = process.session_id;
    let cancelling: Promise<unknown> | undefined;
    const terminate = () => (cancelling ??= client.cancel(session.id, processId, this.scope));
    const writeInput = async (data: { stdin_base64: string } | { close_stdin: true }) => {
      signal.throwIfAborted();
      if (process.termination) throw new Error("Process stdin is closed");
      await client.write(
        session.id,
        processId,
        {
          scope: this.scope,
          request_id: randomBytes(16).toString("hex"),
          chars: "",
          yield_time_ms: 0,
          stdout_offset: process.stdout_offset,
          stderr_offset: process.stderr_offset,
          ...data,
        },
        signal,
      );
    };
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
      if (process.truncated) throw new Error("Sandbox process output exceeded its retention window");
      if (stdoutOpen && process.stdout) stdoutController.enqueue(Buffer.from(process.stdout, "base64"));
      if (stderrOpen && process.stderr) stderrController.enqueue(Buffer.from(process.stderr, "base64"));
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
        if (stdoutOpen) stdoutController.close();
        if (stderrOpen) stderrController.close();
        if (termination.type === "exit") resolveWait({ exitCode: termination.exit_code });
        else if (termination.type === "timeout") resolveWait({ exitCode: 124 });
        else
          rejectWait(
            new Error(termination.type === "sandbox-violation" ? "Sandbox process was denied." : termination.message),
          );
      } catch (error) {
        if (!process.termination)
          await terminate().catch((err) => logger.error({ err }, "sandbox process cancellation failed"));
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
    // A caller can consume a stream before observing wait(). Keep its rejection observable there.
    void completion.catch(() => {});
    const handle: Experimental_SandboxProcess = {
      stdout,
      stderr,
      wait: () => completion,
      kill: async () => {
        if (!process.termination) await terminate();
        await completion;
      },
    };
    if (!options.stdin) return handle;
    return {
      ...handle,
      stdin: new WritableStream<Uint8Array>({
        async write(bytes) {
          for (let offset = 0; offset < bytes.byteLength; offset += 49152) {
            await writeInput({ stdin_base64: Buffer.from(bytes.subarray(offset, offset + 49152)).toString("base64") });
          }
        },
        close: () => writeInput({ close_stdin: true }),
        abort: async () => {
          await handle.kill();
        },
      }),
    };
  }

  async save(candidate: string, requestId: string, signal?: AbortSignal) {
    const path = writableSandboxPath(candidate);
    const workspacePath = `/workspace/${path}`;
    if (!isValidWorkspacePath(workspacePath)) throw new Error("Invalid workspace file path.");
    const session = await this.ensure(signal);
    const baseline = (await this.deps.checkout(this.context)).find((file) => file.workspace_path === workspacePath);
    const filename = path.split("/").at(-1)!;
    if (baseline) {
      const digest = await this.fileDigest(session.id, path, this.operationSignal(signal));
      const file = await this.deps.update(
        {
          sessionId: this.context.sessionId,
          fileId: baseline.id,
          expectedEtag: baseline.etag,
          workspacePath,
          expectedPathGeneration: baseline.path_generation,
          contentSha256: digest,
          operationId: createHash("sha256").update(`${this.context.runId}:${requestId}`).digest("hex"),
          writerType: "agent",
          writerId: this.context.runId,
          sandboxAttempt: this.context,
        },
        async (idempotencyKey, current, claim) => {
          const storage = this.deps.asset();
          const claimInput = claim;
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
        sandboxAttempt: this.context,
      });
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

  dispose(): Promise<void> {
    return this.lease.close();
  }
}

export function requireRunSandbox(sandbox: Experimental_SandboxSession | undefined): RunSandbox {
  if (!(sandbox instanceof RunSandbox)) throw new Error("The run-scoped sandbox is not available.");
  return sandbox;
}
