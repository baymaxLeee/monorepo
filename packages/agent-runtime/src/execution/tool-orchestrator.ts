import { createHash, randomUUID } from "node:crypto";

import type { InferToolSetContext } from "@ai-sdk/provider-utils";
import type { GenericToolApprovalFunction, ToolSet, UIMessage } from "ai";

import { toolPolicyFromMetadata } from "../tools/manifest.js";
import { type ExecApprovalRequirement, ExecPolicy } from "./exec-policy.js";
import {
  FilePolicyError,
  fileToolAccesses,
  permissionProfileFileAccess,
  permissionProfileForFileAccesses,
  type FileAccess,
  type FileSystemPolicy,
  type FileToolAuthority,
  type FileToolName,
} from "./file-system.js";
import {
  applyAdditionalPermissions,
  permissionProfileForEscalatedCommand,
  permissionProfileHasDeniedReads,
  type AdditionalPermissionProfile,
  type ApprovalPolicy,
  type PermissionProfile,
  type SandboxPermissions,
} from "./permissions.js";
import { ProcessManager, type ProcessIdentity } from "./process-manager.js";
import { pendingBashRetries } from "./retry-journal.js";

export interface BashExecutionInput {
  command: string;
  workdir?: string;
  timeout_ms: number;
  sandbox_permissions: SandboxPermissions;
  additional_permissions?: AdditionalPermissionProfile;
  retry_of?: string;
  justification?: string;
  prefix_rule?: string[];
}

export type SandboxViolation =
  | { type: "file-system"; operation: "read" | "write"; path: string }
  | { type: "network"; host: string; port: number; protocol: "http" | "https" | "tcp" };

export interface CommandOutputStreamMetadata {
  totalBytes: number;
  truncated: boolean;
}

export interface CommandOutputMetadata {
  stdout: CommandOutputStreamMetadata;
  stderr: CommandOutputStreamMetadata;
}

interface SandboxAttemptOutput {
  stdout: string;
  stderr: string;
  outputMetadata?: CommandOutputMetadata;
}

export type SandboxAttemptResult = SandboxAttemptOutput &
  (
    | { type: "exit"; exitCode: number }
    | { type: "timeout"; timeoutMs: number }
    | { type: "start-error"; message: string }
    | { type: "sandbox-unavailable"; message: string }
    | { type: "sandbox-violation"; violation: SandboxViolation }
  );

export interface SandboxAttempt {
  attempt: 1 | 2;
  sandboxed: boolean;
  permissionProfile: PermissionProfile;
  process: ProcessIdentity;
  abortSignal: AbortSignal;
}

export type CommandTermination =
  | { type: "exit"; exitCode: number }
  | { type: "timeout"; timeoutMs: number }
  | { type: "start-error"; message: string }
  | { type: "sandbox-unavailable"; message: string }
  | { type: "sandbox-violation"; violation: SandboxViolation; retryId?: string };

export interface OrchestratedCommandResult {
  stdout: string;
  stderr: string;
  outputMetadata?: CommandOutputMetadata;
  termination: CommandTermination;
}

interface Admission {
  kind: "bash" | "file";
  identity: string;
  requirement: ExecApprovalRequirement;
  retryId?: string;
  accesses?: FileAccess[];
}

interface RetryRecord {
  approvedCall?: { id: string; identity: string };
  identity: string;
  violation: SandboxViolation;
  consumed: boolean;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function executionIdentity(input: BashExecutionInput, includeAuthority: boolean): string {
  const value = includeAuthority
    ? input
    : {
        command: input.command,
        workdir: input.workdir ?? null,
        timeout_ms: input.timeout_ms,
      };
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function fileExecutionIdentity(toolName: FileToolName, input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue({ toolName, input })))
    .digest("hex");
}

function permissionCoversViolation(additional: AdditionalPermissionProfile | undefined, violation: SandboxViolation) {
  if (violation.type === "network") {
    return additional?.network?.allowedHosts.some(
      (host) => host.trim().toLowerCase().replace(/\.$/u, "") === violation.host.toLowerCase().replace(/\.$/u, ""),
    );
  }
  return additional?.fileSystem?.some((entry) => {
    if (entry.access !== "write" && !(entry.access === "read" && violation.operation === "read")) return false;
    const root = entry.path.replace(/\/+$/u, "") || "/";
    return root === "/" || violation.path === root || violation.path.startsWith(`${root}/`);
  });
}

function resultFromAttempt(result: SandboxAttemptResult, retryId?: string): OrchestratedCommandResult {
  const output = {
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.outputMetadata ? { outputMetadata: result.outputMetadata } : {}),
  };
  switch (result.type) {
    case "exit":
      return { ...output, termination: { type: "exit", exitCode: result.exitCode } };
    case "timeout":
      return { ...output, termination: { type: "timeout", timeoutMs: result.timeoutMs } };
    case "start-error":
      return { ...output, termination: { type: "start-error", message: result.message } };
    case "sandbox-unavailable":
      return { ...output, termination: { type: "sandbox-unavailable", message: result.message } };
    case "sandbox-violation":
      return {
        ...output,
        termination: { type: "sandbox-violation", violation: result.violation, ...(retryId ? { retryId } : {}) },
      };
  }
}

function approvalStatus(requirement: ExecApprovalRequirement) {
  switch (requirement.type) {
    case "skip":
      return "not-applicable" as const;
    case "needs-approval":
    case "needs-human-approval":
      return { type: "user-approval" as const, ...(requirement.reason ? { reason: requirement.reason } : {}) };
    case "forbidden":
      return { type: "denied" as const, reason: requirement.reason };
  }
}

export class ToolOrchestrator {
  private readonly admissions = new Map<string, Admission>();
  private readonly retries = new Map<string, RetryRecord>();
  private readonly processes: ProcessManager;
  private readonly retryId: () => string;
  private closed = false;

  constructor(
    private readonly settings: {
      approvalPolicy: ApprovalPolicy;
      permissionProfile: PermissionProfile;
      execPolicy?: ExecPolicy;
      retryId?: () => string;
      processManager?: ProcessManager;
      continuation?: UIMessage;
      fileSystemPolicy?: FileSystemPolicy;
    },
  ) {
    this.retryId = settings.retryId ?? randomUUID;
    this.processes = settings.processManager ?? new ProcessManager();
    if (settings.continuation) {
      for (const retry of pendingBashRetries(settings.continuation)) {
        this.retries.set(retry.retryId, {
          identity: executionIdentity(retry.original, false),
          violation: retry.violation,
          consumed: false,
          approvedCall: { id: retry.toolCallId, identity: executionIdentity(retry.input, true) },
        });
      }
    }
  }

  reviewBash(toolCallId: string, input: BashExecutionInput): ExecApprovalRequirement {
    if (this.closed) throw new Error("tool orchestrator is closed");
    const identity = executionIdentity(input, true);
    const existing = this.admissions.get(toolCallId);
    if (existing) {
      if (existing.kind !== "bash" || existing.identity !== identity) {
        throw new Error(`tool call ${toolCallId} changed after admission`);
      }
      return existing.requirement;
    }

    let requirement: ExecApprovalRequirement;
    if (input.retry_of) {
      const retry = this.retries.get(input.retry_of);
      if (!retry) {
        requirement = { type: "forbidden", reason: "sandbox retry does not reference a current denial" };
      } else if (
        retry.approvedCall &&
        (retry.approvedCall.id !== toolCallId || retry.approvedCall.identity !== identity)
      ) {
        requirement = { type: "forbidden", reason: "sandbox retry differs from the approved continuation" };
      } else if (retry.identity !== executionIdentity(input, false)) {
        requirement = { type: "forbidden", reason: "sandbox retry changed the denied command or working directory" };
      } else if (input.sandbox_permissions === "use_default") {
        requirement = {
          type: "forbidden",
          reason: "sandbox retry must request the authority denied by the first attempt",
        };
      } else if (
        input.sandbox_permissions === "with_additional_permissions" &&
        !permissionCoversViolation(input.additional_permissions, retry.violation)
      ) {
        requirement = {
          type: "forbidden",
          reason: "additional permissions do not cover the reported sandbox violation",
        };
      } else if (this.settings.approvalPolicy === "never") {
        requirement = { type: "forbidden", reason: "approval policy forbids sandbox denial retries" };
      } else {
        requirement = { type: "needs-approval", reason: "retry expands authority after a sandbox denial" };
      }
    } else {
      requirement = (this.settings.execPolicy ?? new ExecPolicy()).requirement({
        command: input.command,
        approvalPolicy: this.settings.approvalPolicy,
        permissionProfile: this.settings.permissionProfile,
        sandboxPermissions: input.sandbox_permissions,
        additionalPermissions: input.additional_permissions,
      });
    }
    this.admissions.set(toolCallId, {
      kind: "bash",
      identity,
      requirement,
      ...(input.retry_of ? { retryId: input.retry_of } : {}),
    });
    return requirement;
  }

  reviewFileTool(toolCallId: string, toolName: FileToolName, input: unknown): ExecApprovalRequirement {
    if (this.closed) throw new Error("tool orchestrator is closed");
    const identity = fileExecutionIdentity(toolName, input);
    const existing = this.admissions.get(toolCallId);
    if (existing) {
      if (existing.kind !== "file" || existing.identity !== identity) {
        throw new Error(`tool call ${toolCallId} changed after admission`);
      }
      return existing.requirement;
    }
    const policy = this.settings.fileSystemPolicy;
    if (!policy) return { type: "forbidden", reason: "execution host does not expose model file tools" };

    let accesses: FileAccess[];
    let requirement: ExecApprovalRequirement;
    try {
      accesses = fileToolAccesses(toolName, input, policy);
      const decisions = accesses.map((access) => permissionProfileFileAccess(this.settings.permissionProfile, access));
      if (decisions.includes("denied")) {
        throw new FilePolicyError("file access is denied by the active permission profile");
      }
      const needsAuthority = decisions.includes("missing");
      const mutates = accesses.some((access) => access.access === "write");
      if (needsAuthority && this.settings.permissionProfile.type === "external") {
        requirement = { type: "forbidden", reason: "external sandbox enforcement cannot grant host file access" };
      } else if (needsAuthority && this.settings.approvalPolicy === "never") {
        requirement = { type: "forbidden", reason: "approval policy forbids additional file authority" };
      } else if (needsAuthority) {
        requirement = { type: "needs-approval", reason: "file operation requires additional exact-path authority" };
      } else if (mutates && this.settings.approvalPolicy === "unless-trusted") {
        requirement = { type: "needs-human-approval", reason: "project is not trusted" };
      } else {
        requirement = { type: "skip", bypassSandbox: false, reason: null };
      }
    } catch (error) {
      accesses = [];
      requirement = {
        type: "forbidden",
        reason:
          error instanceof FilePolicyError
            ? error.reason
            : error instanceof Error
              ? error.message
              : "file admission failed",
      };
    }
    this.admissions.set(toolCallId, { kind: "file", identity, requirement, accesses });
    return requirement;
  }

  readonly toolApproval: GenericToolApprovalFunction<ToolSet, InferToolSetContext<ToolSet>, Record<string, unknown>> =
    ({ toolCall }) => {
      if (toolCall.toolName === "bash") {
        try {
          return approvalStatus(this.reviewBash(toolCall.toolCallId, toolCall.input as BashExecutionInput));
        } catch (error) {
          return { type: "denied", reason: error instanceof Error ? error.message : "command admission failed" };
        }
      }
      if (
        toolCall.toolName === "read_file" ||
        toolCall.toolName === "apply_patch" ||
        toolCall.toolName === "write_file"
      ) {
        try {
          return approvalStatus(
            this.reviewFileTool(toolCall.toolCallId, toolCall.toolName as FileToolName, toolCall.input),
          );
        } catch (error) {
          return { type: "denied", reason: error instanceof Error ? error.message : "file admission failed" };
        }
      }
      const policy = toolPolicyFromMetadata(toolCall.toolMetadata);
      if (!policy || policy.effect === "unknown" || policy.effect === "destructive" || policy.source === "mcp") {
        return this.settings.approvalPolicy === "never"
          ? { type: "denied", reason: "approval policy forbids unclassified or external side effects" }
          : { type: "user-approval", reason: "tool may cause an external side effect" };
      }
      if (policy.execution === "client" || policy.capability === "interaction") return "not-applicable";
      if (this.settings.approvalPolicy === "unless-trusted" && policy.effect !== "read") {
        return { type: "user-approval", reason: "project is not trusted" };
      }
      if (this.settings.approvalPolicy === "on-request" && policy.trust === "open-world" && policy.effect !== "read") {
        return { type: "user-approval", reason: "tool acts on an open-world target" };
      }
      return "not-applicable";
    };

  async runBash(
    toolCallId: string,
    input: BashExecutionInput,
    execute: (attempt: SandboxAttempt) => Promise<SandboxAttemptResult>,
  ): Promise<OrchestratedCommandResult> {
    if (this.closed) throw new Error("tool orchestrator is closed");
    const admission = this.admissions.get(toolCallId);
    if (!admission) throw new Error(`tool call ${toolCallId} was not admitted`);
    if (admission.kind !== "bash" || admission.identity !== executionIdentity(input, true)) {
      throw new Error(`tool call ${toolCallId} changed after admission`);
    }
    if (admission.requirement.type === "forbidden") throw new Error(admission.requirement.reason);

    const retry = admission.retryId ? this.retries.get(admission.retryId) : undefined;
    if (admission.retryId && (!retry || retry.consumed))
      throw new Error(`sandbox retry ${admission.retryId} was already consumed`);
    if (retry) retry.consumed = true;
    this.admissions.delete(toolCallId);

    let permissionProfile = this.settings.permissionProfile;
    let sandboxed = permissionProfile.type !== "disabled";
    if (admission.requirement.type === "skip" && admission.requirement.bypassSandbox) sandboxed = false;
    if (input.sandbox_permissions === "with_additional_permissions") {
      permissionProfile = applyAdditionalPermissions(permissionProfile, input.additional_permissions);
      sandboxed = permissionProfile.type !== "disabled";
    } else if (input.sandbox_permissions === "require_escalated") {
      if (permissionProfileHasDeniedReads(permissionProfile)) {
        permissionProfile = permissionProfileForEscalatedCommand(permissionProfile);
        sandboxed = true;
      } else {
        permissionProfile = { type: "disabled" };
        sandboxed = false;
      }
    }

    return this.processes.run(async (process, abortSignal) => {
      const result = await execute({
        attempt: retry ? 2 : 1,
        sandboxed,
        permissionProfile,
        process,
        abortSignal,
      });
      if (result.type !== "sandbox-violation" || retry || this.settings.approvalPolicy === "never") {
        return resultFromAttempt(result);
      }
      const retryId = this.retryId();
      this.retries.set(retryId, {
        identity: executionIdentity(input, false),
        violation: result.violation,
        consumed: false,
      });
      return resultFromAttempt(result, retryId);
    });
  }

  async runFileTool<T>(
    toolCallId: string,
    toolName: FileToolName,
    input: unknown,
    execute: (authority: FileToolAuthority) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new Error("tool orchestrator is closed");
    const admission = this.admissions.get(toolCallId);
    if (!admission) throw new Error(`tool call ${toolCallId} was not admitted`);
    if (admission.kind !== "file" || admission.identity !== fileExecutionIdentity(toolName, input)) {
      throw new Error(`tool call ${toolCallId} changed after admission`);
    }
    this.admissions.delete(toolCallId);
    if (admission.requirement.type === "forbidden") throw new Error(admission.requirement.reason);
    const accesses = admission.accesses ?? [];
    const permissionProfile = permissionProfileForFileAccesses(this.settings.permissionProfile, accesses);
    return this.processes.run((process, abortSignal) => execute({ accesses, permissionProfile, process, abortSignal }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.processes.closeAll();
    this.admissions.clear();
    this.retries.clear();
  }
}
