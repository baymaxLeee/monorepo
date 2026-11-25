import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { TransportError } from "#runtime/transport";

import { sandboxClient } from "../infrastructure/clients/sandbox.js";
import { getDb } from "../infrastructure/persistence/index.js";
import { turnLeases, turnSandboxExecutions as sandboxExecutions } from "../infrastructure/persistence/schema.js";
import { ConflictError, RequestError } from "./errors.js";
import { editableFileByteLimit } from "./file-edit-limits.js";
import { getSessionFile, type SessionFile } from "./session-files.js";

type UserFileScope = {
  sessionId: string;
  fileId: string;
};

interface ActiveWorkspace {
  sandboxId: string | null;
  state: string;
  scope: {
    session_id: string;
    run_id: string;
    attempt_epoch: string;
    workspace_generation: string;
  };
}

export interface CloudWorkspaceEditDependencies {
  active(input: UserFileScope): Promise<ActiveWorkspace | null>;
  file(input: UserFileScope): Promise<SessionFile>;
  acquire(workspace: ActiveWorkspace, token: string): Promise<void>;
  release(workspace: ActiveWorkspace, token: string): Promise<void>;
  download(workspace: ActiveWorkspace, path: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  upload(
    workspace: ActiveWorkspace,
    path: string,
    content: Uint8Array,
    token: string,
    signal?: AbortSignal,
  ): Promise<void>;
}

const defaults: CloudWorkspaceEditDependencies = {
  async active(input) {
    const [row] = await getDb()
      .select({ execution: sandboxExecutions })
      .from(sandboxExecutions)
      .innerJoin(
        turnLeases,
        and(
          eq(turnLeases.turnId, sandboxExecutions.turnId),
          eq(turnLeases.attemptEpoch, sandboxExecutions.attemptEpoch),
        ),
      )
      .where(
        and(
          eq(sandboxExecutions.threadId, input.sessionId),
          inArray(sandboxExecutions.state, ["restoring", "active", "finalizing"]),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      sandboxId: row.execution.sandboxId,
      state: row.execution.state,
      scope: {
        session_id: row.execution.threadId,
        run_id: row.execution.turnId,
        attempt_epoch: row.execution.attemptEpoch.toString(),
        workspace_generation: row.execution.workspaceGeneration.toString(),
      },
    };
  },
  file: (input) => getSessionFile(input.sessionId, input.fileId),
  async acquire(workspace, token) {
    if (!workspace.sandboxId) throw new Error("active cloud workspace has no sandbox resource");
    try {
      await sandboxClient().acquireWorkspaceEdit(workspace.sandboxId, workspace.scope, token);
    } catch (error) {
      const message =
        error instanceof TransportError &&
        error.body &&
        typeof error.body === "object" &&
        "message" in error.body &&
        typeof error.body.message === "string"
          ? error.body.message
          : "";
      if (
        error instanceof TransportError &&
        error.status === 422 &&
        /workspace .*in progress|active process/.test(message)
      ) {
        throw new ConflictError(
          "the cloud workspace has an active writer; keep the draft and retry shortly",
          "workspace_busy",
        );
      }
      throw error;
    }
  },
  async release(workspace, token) {
    if (!workspace.sandboxId) return;
    await sandboxClient().releaseWorkspaceEdit(workspace.sandboxId, workspace.scope, token);
  },
  async download(workspace, path, signal) {
    if (!workspace.sandboxId) throw new Error("active cloud workspace has no sandbox resource");
    return sandboxClient().download(workspace.sandboxId, workspace.scope, path.slice("/workspace/".length), signal);
  },
  async upload(workspace, path, content, token, signal) {
    if (!workspace.sandboxId) throw new Error("active cloud workspace has no sandbox resource");
    await sandboxClient().upload(
      workspace.sandboxId,
      workspace.scope,
      path.slice("/workspace/".length),
      new Blob([content]).stream(),
      signal,
      token,
    );
  },
};

async function readBounded(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > editableFileByteLimit()) throw new Error("active workspace file exceeds editable file limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function coordinateCloudWorkspaceUserEdit<T>(
  input: UserFileScope & {
    expectedEtag: string;
    operationId: string;
    content: Uint8Array;
    signal?: AbortSignal;
  },
  commit: (attempt?: { runId: string; attemptEpoch: string }) => Promise<T>,
  deps: CloudWorkspaceEditDependencies = defaults,
): Promise<T> {
  const workspace = await deps.active(input);
  if (!workspace) return commit();
  if (workspace.state !== "active" || !workspace.sandboxId) {
    throw new ConflictError(
      "the cloud workspace is changing lifecycle state; keep the draft and retry shortly",
      "workspace_busy",
    );
  }

  const token = `user-${input.operationId}`;
  await deps.acquire(workspace, token);

  const attempt = { runId: workspace.scope.run_id, attemptEpoch: workspace.scope.attempt_epoch };
  let release = true;
  try {
    input.signal?.throwIfAborted();
    const file = await deps.file(input);
    if (!file.editable) throw new RequestError("file is not editable");
    const previous = await readBounded(await deps.download(workspace, file.workspace_path, input.signal));
    const previousSha = sha256(previous);
    const nextSha = sha256(input.content);
    if (file.etag !== input.expectedEtag) {
      if (file.sha256 === nextSha && previousSha === nextSha) return commit(attempt);
      throw new ConflictError("session file changed since it was read", "file_content_conflict", {
        current_etag: file.etag,
      });
    }
    if (previousSha !== file.sha256 && previousSha !== nextSha) {
      throw new ConflictError(
        "the Agent changed this workspace file after the editor loaded it; keep the draft and reload",
        "file_content_conflict",
        { current_etag: file.etag },
      );
    }
    if (previousSha !== nextSha) {
      await deps.upload(workspace, file.workspace_path, input.content, token, input.signal);
    }
    try {
      return await commit(attempt);
    } catch (error) {
      try {
        if (previousSha !== nextSha) await deps.upload(workspace, file.workspace_path, previous, token);
      } catch {
        // Keep the guest fence held. A retry with the same operation token can
        // finish or repair the idempotent save without exposing divergent bytes.
        release = false;
      }
      throw error;
    }
  } finally {
    if (release) await deps.release(workspace, token);
  }
}
