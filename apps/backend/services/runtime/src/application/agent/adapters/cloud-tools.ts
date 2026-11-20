import type { ExecutionEnvironment } from "@repo/agent-runtime/execution/environment";
import { canonicalizeShellCommand } from "@repo/agent-runtime/execution/exec-policy";
import { createExecutionHostManifests } from "@repo/agent-runtime/execution/execution-host";
import {
  clonePermissionProfile,
  compilePermissionProfile,
  permissionProfileSummary,
  type ApprovalPolicy,
  type BuiltInPermissionProfileId,
  type PermissionProfile,
} from "@repo/agent-runtime/execution/permissions";
import { ProcessManager } from "@repo/agent-runtime/execution/process-manager";
import { ToolOrchestrator, type SandboxViolation } from "@repo/agent-runtime/execution/tool-orchestrator";

import { artifactToolContextSchema } from "../tools/context.js";
import { requireRunSandbox } from "./cloud-sandbox.js";

export const CLOUD_EXECUTION_ENVIRONMENT = {
  location: "cloud",
  workspace: {
    root: "/workspace",
    access: "read-write",
    isolation: "ephemeral",
    persistence: "session",
    externalSources: "read-only",
  },
  network: { access: "restricted", protocols: ["http", "https"] },
  process: { shell: true, lifetime: "command", backgroundServices: "unsupported" },
  deliverables: "session-file",
  permissions: { profileId: ":workspace", enforcement: "managed", approvalPolicy: "on-request" },
} as const satisfies ExecutionEnvironment;

function cloudPermissionProfile(id: BuiltInPermissionProfileId): PermissionProfile {
  const profile = compilePermissionProfile(id, { workspaceRoot: "/workspace" }).profile;
  if (profile.type === "managed" && profile.fileSystem.type === "restricted") {
    profile.fileSystem.entries.push(
      { path: "/workspace/sources", access: "read" },
      { path: "/workspace/.home", access: "deny" },
      { path: "/run/control", access: "deny" },
      { path: "/run/egress", access: "deny" },
    );
  }
  return clonePermissionProfile(profile);
}

function networkViolationHint(command: string): SandboxViolation | undefined {
  const canonical = canonicalizeShellCommand(command);
  if (!canonical.analyzable) return undefined;
  for (const token of canonical.commands.flat()) {
    try {
      const url = new URL(token);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      return {
        type: "network",
        host: url.hostname,
        port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        protocol: url.protocol === "https:" ? "https" : "http",
      };
    } catch {
      // Non-URL argv tokens do not describe a network authority.
    }
  }
  return undefined;
}

export async function createCloudToolAdapters(
  settings: {
    approvalPolicy: ApprovalPolicy;
    permissionProfile: BuiltInPermissionProfileId;
  } = { approvalPolicy: "on-request", permissionProfile: ":workspace" },
) {
  const permissionProfile = cloudPermissionProfile(settings.permissionProfile);
  const environment: ExecutionEnvironment = {
    ...CLOUD_EXECUTION_ENVIRONMENT,
    permissions: {
      profileId: settings.permissionProfile,
      enforcement: permissionProfileSummary(permissionProfile),
      approvalPolicy: settings.approvalPolicy,
    },
  };
  const processManager = new ProcessManager();
  const orchestrator = new ToolOrchestrator({
    approvalPolicy: settings.approvalPolicy,
    permissionProfile,
    processManager,
    fileSystemPolicy: {
      workspaceRoot: "/workspace",
      workingDirectory: "/workspace/work",
      immutableWriteRoots: ["/workspace/sources", "/workspace/.home"],
    },
  });
  const manifests = createExecutionHostManifests(
    {
      environment,
      orchestrator,
      run: async (input, attempt, options) => {
        options.abortSignal?.throwIfAborted();
        return requireRunSandbox(options.experimental_sandbox).runAttempt(attempt, {
          command: input.command,
          workingDirectory: input.workdir ?? "/workspace/work",
          timeoutMs: input.timeout_ms,
          abortSignal: options.abortSignal,
          violationHint: networkViolationHint(input.command),
        });
      },
      files: {
        readText: (input, authority, options) =>
          requireRunSandbox(options.experimental_sandbox).readTextSnapshot({
            path: input.path,
            abortSignal: options.abortSignal
              ? AbortSignal.any([options.abortSignal, authority.abortSignal])
              : authority.abortSignal,
          }),
        writeText: (input, authority, options) =>
          requireRunSandbox(options.experimental_sandbox).writeTextFileConditional({
            ...input,
            abortSignal: options.abortSignal
              ? AbortSignal.any([options.abortSignal, authority.abortSignal])
              : authority.abortSignal,
          }),
        deleteFile: (input, authority, options) =>
          requireRunSandbox(options.experimental_sandbox).deleteTextFile({
            ...input,
            abortSignal: options.abortSignal
              ? AbortSignal.any([options.abortSignal, authority.abortSignal])
              : authority.abortSignal,
          }),
      },
      refreshSources: (options) => requireRunSandbox(options.experimental_sandbox).refresh(options.abortSignal),
      deliver: (input, options) =>
        requireRunSandbox(options.experimental_sandbox).save(input, options.toolCallId, options.abortSignal),
    },
    { contextSchema: artifactToolContextSchema },
  );
  return {
    environment,
    manifests,
    permissionProfile,
    processManager,
    toolApproval: orchestrator.toolApproval,
    dispose: async () => orchestrator.close(),
  };
}
