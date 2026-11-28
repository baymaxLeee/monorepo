import {
  type ToolOrchestrator,
  type SandboxViolation,
  createExecutionHostManifests,
  canonicalizeShellCommand,
  type ExecutionEnvironment,
  type compilePermissionProfile,
} from "@repo/agent-runtime";

import type { LocalThread } from "../../contracts/bridge.generated";
import type { LocalWorkspaces } from "./workspace";

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

export function localExecutionTools(
  thread: LocalThread,
  workspaces: LocalWorkspaces,
  activePermission: ReturnType<typeof compilePermissionProfile>,
  orchestrator: ToolOrchestrator,
  attachmentRoot: string,
) {
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
    process: { shell: true, lifetime: "session", backgroundServices: "session-scoped" },
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
        const result = await workspaces.access(thread.workspace, (current) =>
          current.sandbox.file(
            authority.permissionProfile,
            { operation: "readOptional", path },
            signal,
            attachmentRoot,
          ),
        );
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
    run: async (input, attempt, options, io) => {
      options.abortSignal?.throwIfAborted();
      const { w, running } = await workspaces.access(thread.workspace, async (w) => {
        const running = w.sandbox.execute(
          { ...attempt, attachmentRoot },
          input.shell ?? "/bin/bash",
          [input.login ? "-lc" : "-c", input.command],
          undefined,
          io.signal,
          undefined,
          networkViolationHint(input.command),
          io,
          input.workdir,
        );
        return { w, running };
      });
      const result = await running;
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      w.flushChanges();
      return result;
    },
  });
  return { environment, executionManifests };
}
