import { createHash } from "node:crypto";

import { workspaceMediaType } from "@repo/agent-runtime";

import { sandboxClient } from "../infrastructure/clients/sandbox.js";
import type { RuntimeSandboxAdapter } from "../infrastructure/clients/sandbox.js";
import type { StorageClient } from "../infrastructure/clients/storage.js";
import { storageClient } from "../infrastructure/clients/storage.js";
import { ConflictError } from "./errors.js";
import { deleteWorkspaceSessionFile, listSessionFiles, publishSessionFile, saveSessionFile } from "./session-files.js";
import { readWorkspaceCheckout } from "./workspace-checkout.js";
import { isValidWorkspacePath } from "./workspace-paths.js";

export interface CloudWorkspaceScope {
  sessionId: string;
  runId: string;
  attemptEpoch: string;
}

export interface CloudWorkspaceDependencies {
  sandbox: () => Pick<RuntimeSandboxAdapter, "snapshot" | "download">;
  asset: () => Pick<StorageClient, "upload" | "appendRevision" | "prepareClaim" | "activateClaim">;
  checkout: typeof readWorkspaceCheckout;
  files: typeof listSessionFiles;
  publish: typeof publishSessionFile;
  update: typeof saveSessionFile;
  delete: typeof deleteWorkspaceSessionFile;
}

const defaults: CloudWorkspaceDependencies = {
  sandbox: sandboxClient,
  asset: storageClient,
  checkout: readWorkspaceCheckout,
  files: listSessionFiles,
  publish: publishSessionFile,
  update: saveSessionFile,
  delete: deleteWorkspaceSessionFile,
};

export function isMissingSandboxResourceError(error: unknown): boolean {
  if (!(error instanceof Error) || !("service" in error) || error.service !== "runtime-sandbox") return false;
  const body = "body" in error && error.body && typeof error.body === "object" ? error.body : null;
  return (
    "status" in error && error.status === 404 && body != null && "code" in body && body.code === "sandbox_not_found"
  );
}

export function workspaceFinalizationIsObsolete(error: unknown): boolean {
  return (
    (error instanceof ConflictError && error.code === "workspace_writer_superseded") ||
    isMissingSandboxResourceError(error)
  );
}

function verifySnapshot(
  entry: { path: string; size: number; sha256: string },
  asset: { sizeBytes: number; sha256: string },
) {
  if (asset.sizeBytes !== entry.size || asset.sha256 !== entry.sha256) {
    throw new Error(`Storage content differs from the frozen workspace snapshot for ${entry.path}`);
  }
}

export async function persistCloudWorkspace(
  context: CloudWorkspaceScope,
  sandboxId: string,
  deps: CloudWorkspaceDependencies = defaults,
): Promise<void> {
  const scope = {
    session_id: context.sessionId,
    run_id: context.runId,
    attempt_epoch: context.attemptEpoch,
  };
  const [snapshot, files] = await Promise.all([deps.sandbox().snapshot(sandboxId, scope), deps.checkout(context)]);
  const baseline = new Map(files.map((file) => [file.workspace_path, file]));
  const livePaths = new Set<string>();
  let published: Map<string, Awaited<ReturnType<typeof listSessionFiles>>[number]> | undefined;

  for (const entry of snapshot.files) {
    const workspacePath = `/workspace/${entry.path}`;
    if (!isValidWorkspacePath(workspacePath) || workspacePath.startsWith("/workspace/sources/")) {
      throw new Error(`sandbox returned invalid business path ${workspacePath}`);
    }
    if (livePaths.has(workspacePath)) throw new Error(`sandbox snapshot repeated ${workspacePath}`);
    livePaths.add(workspacePath);
    const current = baseline.get(workspacePath);
    if (current?.sha256 === entry.sha256 && current.size === entry.size) continue;
    if (current) {
      await deps.update(
        {
          sessionId: context.sessionId,
          fileId: current.id,
          expectedEtag: current.etag,
          contentSha256: entry.sha256,
          operationId: createHash("sha256")
            .update(`${context.runId}:workspace-update:${workspacePath}:${entry.sha256}`)
            .digest("hex"),
          writerType: "agent",
          writerId: context.runId,
          sandboxAttempt: context,
          workspacePath,
          expectedPathGeneration: current.path_generation,
        },
        async (idempotencyKey, file, claim) => {
          const storage = deps.asset();
          const claimInput = claim;
          await storage.prepareClaim({
            ...claimInput,
            assetId: file.asset_id,
            revisionId: file.revision_id,
            kind: "strong",
          });
          await storage.activateClaim(claimInput);
          const body = await deps.sandbox().download(sandboxId, scope, entry.path);
          try {
            const asset = await storage.appendRevision({
              assetId: file.asset_id,
              baseRevisionId: file.revision_id,
              ...claim,
              filename: file.filename,
              mediaType: file.mime_type,
              body,
              idempotencyKey,
            });
            verifySnapshot(entry, asset);
            return asset;
          } finally {
            if (!body.locked) await body.cancel().catch(() => {});
          }
        },
      );
      continue;
    }

    // A worker can die between staging a durable provider file and recording its checkout.
    // Only a path present in this frozen snapshot is eligible for recovery.
    published ??= new Map((await deps.files(context)).map((file) => [file.workspace_path, file]));
    const existing = published.get(workspacePath);
    if (existing) {
      if (existing.sha256 === entry.sha256 && existing.size === entry.size) continue;
      throw new ConflictError(
        `Workspace path already contains a different published file: ${workspacePath}`,
        "workspace_path_conflict",
      );
    }

    const body = await deps.sandbox().download(sandboxId, scope, entry.path);
    const filename = workspacePath.split("/").at(-1) ?? "file";
    const idempotencyKey = createHash("sha256")
      .update(`${context.runId}:workspace-create:${workspacePath}:${entry.sha256}`)
      .digest("hex");
    try {
      const asset = await deps.asset().upload({
        filename,
        mediaType: workspaceMediaType(filename),
        category: "sandbox-workspace",
        body,
        idempotencyKey,
      });
      verifySnapshot(entry, asset);
      await deps.publish({
        sessionId: context.sessionId,
        title: filename,
        assetId: asset.assetId,
        revisionId: asset.revisionId,
        filename: asset.filename,
        mediaType: asset.mediaType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        idempotencyKey,
        workspacePath,
        writerType: "agent",
        writerId: context.runId,
        sandboxAttempt: context,
      });
    } finally {
      if (!body.locked) await body.cancel().catch(() => {});
    }
  }

  for (const [workspacePath, file] of baseline) {
    if (livePaths.has(workspacePath)) continue;
    await deps.delete({
      sessionId: context.sessionId,
      fileId: file.id,
      workspacePath,
      expectedPathGeneration: file.path_generation,
      expectedEtag: file.etag,
      writerId: context.runId,
      sandboxAttempt: context,
    });
  }
}
