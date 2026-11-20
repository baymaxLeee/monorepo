import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve } from "node:path";

import type { ExecutionEnvironment } from "@repo/agent-runtime/execution/environment";
import { canonicalizeShellCommand } from "@repo/agent-runtime/execution/exec-policy";
import { createExecutionHostManifests } from "@repo/agent-runtime/execution/execution-host";
import type { compilePermissionProfile } from "@repo/agent-runtime/execution/permissions";
import type { ToolOrchestrator, SandboxViolation } from "@repo/agent-runtime/execution/tool-orchestrator";
import { workspaceMediaType, type PublishedWorkspaceFile } from "@repo/agent-runtime/protocol/artifact";
import type { UIMessage } from "ai";

import type { LocalThread } from "../../contracts/bridge.generated";
import type { LocalWorkspaces } from "./workspace";
function localWorkspacePath(root: string, value: string): string {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const path = relative(root, absolute);
  if (!path || path === ".." || path.startsWith("../") || isAbsolute(path)) {
    throw new Error("发布文件必须位于授权工作目录内");
  }
  return path;
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

function publishedArtifacts(messages: UIMessage[]): Map<string, PublishedWorkspaceFile> {
  const artifacts = new Map<string, PublishedWorkspaceFile>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "data-file" || !part.data || typeof part.data !== "object") continue;
      const value = part.data as unknown as PublishedWorkspaceFile;
      if (typeof value.file_id === "string" && typeof value.workspace_path === "string") {
        artifacts.set(value.file_id, value);
      }
    }
  }
  return artifacts;
}

export function localExecutionTools(
  thread: LocalThread,
  workspaces: LocalWorkspaces,
  activePermission: ReturnType<typeof compilePermissionProfile>,
  orchestrator: ToolOrchestrator,
  modelEpoch: () => number,
) {
  const artifacts = publishedArtifacts(thread.messages);
  const environment = {
    location: "local",
    workspace: {
      root: thread.workspace,
      access: "read-write",
      isolation: "direct",
      persistence: "host",
      externalSources: "unavailable",
    },
    network: {
      access: activePermission.profile.type === "disabled" ? "public" : "restricted",
      protocols: ["http", "https"],
    },
    process: { shell: true, lifetime: "command", backgroundServices: "unsupported" },
    deliverables: "workspace-reference",
    permissions: {
      profileId: activePermission.id,
      enforcement: activePermission.profile.type,
      approvalPolicy: thread.approvalPolicy,
    },
  } as const satisfies ExecutionEnvironment;
  const executionManifests = createExecutionHostManifests({
    environment,
    orchestrator,
    files: {
      readText: async ({ path }, authority, options) => {
        const signal = options.abortSignal
          ? AbortSignal.any([options.abortSignal, authority.abortSignal])
          : authority.abortSignal;
        const result = await workspaces.access(thread.workspace, (current) => {
          if (current.epoch !== modelEpoch()) {
            throw new Error("工作区在推理后发生变化，请重新读取相关输入再执行");
          }
          return current.sandbox.file(authority.permissionProfile, { operation: "readOptional", path }, signal);
        });
        if (result === null) return null;
        if (
          !result ||
          typeof result !== "object" ||
          !("content" in result) ||
          typeof result.content !== "string" ||
          !("hash" in result) ||
          typeof result.hash !== "string" ||
          !/^[a-f0-9]{64}$/u.test(result.hash)
        ) {
          throw new Error("文件 helper 返回了无效读取结果");
        }
        return { content: result.content, sha256: result.hash, bytes: Buffer.byteLength(result.content) };
      },
      writeText: async ({ path, content, mode, expectedSha256 }, authority, options) => {
        const signal = options.abortSignal
          ? AbortSignal.any([options.abortSignal, authority.abortSignal])
          : authority.abortSignal;
        const result = await workspaces.access(thread.workspace, async (current) => {
          if (current.epoch !== modelEpoch()) {
            throw new Error("工作区在推理后发生变化，请重新读取相关输入再执行");
          }
          const written = await current.sandbox.file(
            authority.permissionProfile,
            {
              operation: "write",
              path,
              content,
              expectedHash: mode === "create" ? null : expectedSha256,
            },
            signal,
          );
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
          current.flushChanges();
          return written;
        });
        if (
          !result ||
          typeof result !== "object" ||
          !("hash" in result) ||
          typeof result.hash !== "string" ||
          !/^[a-f0-9]{64}$/u.test(result.hash)
        ) {
          throw new Error("文件 helper 返回了无效写入结果");
        }
        return {
          path,
          sha256: result.hash,
          bytes: Buffer.byteLength(content),
          created: mode === "create",
        };
      },
      deleteFile: async ({ path, expectedSha256 }, authority, options) => {
        const signal = options.abortSignal
          ? AbortSignal.any([options.abortSignal, authority.abortSignal])
          : authority.abortSignal;
        await workspaces.access(thread.workspace, async (current) => {
          if (current.epoch !== modelEpoch()) {
            throw new Error("工作区在推理后发生变化，请重新读取相关输入再执行");
          }
          await current.sandbox.file(
            authority.permissionProfile,
            { operation: "delete", path, expectedHash: expectedSha256 },
            signal,
          );
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
          current.flushChanges();
        });
      },
    },
    deliver: async (candidate, options) => {
      const path = localWorkspacePath(thread.workspace, candidate);
      const inspection = await workspaces.access(thread.workspace, (current) =>
        current.sandbox.file(activePermission.profile, { operation: "inspect", path }, options.abortSignal),
      );
      if (
        !inspection ||
        typeof inspection !== "object" ||
        !("size" in inspection) ||
        !Number.isSafeInteger(inspection.size) ||
        !("etag" in inspection) ||
        typeof inspection.etag !== "string" ||
        !/^"[a-f0-9]{32}"$/.test(inspection.etag)
      ) {
        throw new Error("无法检查待交付文件");
      }
      const fileId = createHash("sha256").update(`${thread.id}\0${path}`).digest("hex").slice(0, 32);
      const previous = artifacts.get(fileId);
      const data: PublishedWorkspaceFile = {
        file_id: fileId,
        filename: previous?.filename ?? basename(path),
        title: previous?.title ?? basename(path),
        media_type: previous?.media_type ?? workspaceMediaType(path),
        kind: previous?.kind ?? (path.toLowerCase().endsWith("-plan.md") ? "plan" : "artifact"),
        etag: inspection.etag,
        updated: Boolean(previous),
        workspace_path: path,
      };
      artifacts.set(fileId, data);
      return data;
    },
    run: (input, attempt, options) =>
      workspaces.access(thread.workspace, async (w) => {
        if (w.epoch !== modelEpoch()) throw new Error("工作区在推理后发生变化，请重新读取相关输入再执行");
        const result = await w.sandbox.execute(
          attempt,
          "/bin/bash",
          [
            "--noprofile",
            "--norc",
            "-c",
            'cd -- "$1" && eval "$2"',
            "bash",
            input.workdir ?? thread.workspace,
            input.command,
          ],
          undefined,
          options.abortSignal,
          input.timeout_ms,
          networkViolationHint(input.command),
        );
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        w.flushChanges();
        return result;
      }),
  });
  return { environment, executionManifests };
}
