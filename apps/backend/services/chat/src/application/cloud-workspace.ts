import { createHash } from "node:crypto";

import type { SandboxInternalClient, StorageInternalClient } from "@backend/transport-ts";

import { sandboxClient } from "../infrastructure/clients/sandbox.js";
import { storageClient } from "../infrastructure/clients/storage.js";
import {
  deleteWorkspaceConversationFile,
  listConversationFiles,
  publishConversationFile,
  saveConversationFile,
} from "./conversation-files.js";
import { isValidWorkspacePath } from "./workspace-paths.js";

export interface CloudWorkspaceScope {
  tenantId: string;
  workspaceId: string;
  userId: string;
  conversationId: string;
  runId: string;
}

export interface CloudWorkspaceDependencies {
  sandbox: () => Pick<SandboxInternalClient, "snapshot" | "download">;
  asset: () => Pick<StorageInternalClient, "upload" | "appendRevision" | "prepareClaim" | "activateClaim">;
  files: typeof listConversationFiles;
  publish: typeof publishConversationFile;
  update: typeof saveConversationFile;
  delete: typeof deleteWorkspaceConversationFile;
}

const defaults: CloudWorkspaceDependencies = {
  sandbox: sandboxClient,
  asset: storageClient,
  files: listConversationFiles,
  publish: publishConversationFile,
  update: saveConversationFile,
  delete: deleteWorkspaceConversationFile,
};

function mediaType(path: string): string {
  const extension = path.toLowerCase().split(".").at(-1);
  return (
    {
      css: "text/css",
      csv: "text/csv",
      html: "text/html",
      js: "text/javascript",
      json: "application/json",
      md: "text/markdown",
      mjs: "text/javascript",
      py: "text/x-python",
      ts: "text/typescript",
      tsx: "text/typescript",
      txt: "text/plain",
      yaml: "application/yaml",
      yml: "application/yaml",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

export async function persistCloudWorkspace(
  context: CloudWorkspaceScope,
  sandboxId: string,
  deps: CloudWorkspaceDependencies = defaults,
): Promise<void> {
  const scope = {
    tenant_id: context.tenantId,
    workspace_id: context.workspaceId,
    user_id: context.userId,
    conversation_id: context.conversationId,
    run_id: context.runId,
  };
  const [snapshot, files] = await Promise.all([
    deps.sandbox().snapshot(sandboxId, scope),
    deps.files({
      userId: context.userId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      conversationId: context.conversationId,
    }),
  ]);
  const baseline = new Map(files.map((file) => [file.workspace_path, file]));
  const livePaths = new Set<string>();

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
          userId: context.userId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          conversationId: context.conversationId,
          fileId: current.id,
          expectedEtag: current.etag,
          contentSha256: entry.sha256,
          operationId: createHash("sha256")
            .update(`${context.runId}:workspace-update:${workspacePath}:${entry.sha256}`)
            .digest("hex"),
          writerType: "agent",
          writerId: context.runId,
          workspacePath,
          expectedPathGeneration: current.path_generation,
        },
        async (idempotencyKey, file, claim) => {
          const storage = deps.asset();
          const claimInput = { tenantId: context.tenantId, workspaceId: context.workspaceId, ...claim };
          await storage.prepareClaim({
            ...claimInput,
            assetId: file.asset_id,
            revisionId: file.revision_id,
            kind: "strong",
          });
          await storage.activateClaim(claimInput);
          const body = await deps.sandbox().download(sandboxId, scope, entry.path);
          try {
            return await storage.appendRevision({
              ...context,
              assetId: file.asset_id,
              baseRevisionId: file.revision_id,
              ...claim,
              filename: file.filename,
              mediaType: file.mime_type,
              body,
              idempotencyKey,
            });
          } finally {
            if (!body.locked) await body.cancel().catch(() => {});
          }
        },
      );
      continue;
    }

    const body = await deps.sandbox().download(sandboxId, scope, entry.path);
    const filename = workspacePath.split("/").at(-1) ?? "file";
    const idempotencyKey = createHash("sha256")
      .update(`${context.runId}:workspace-create:${workspacePath}:${entry.sha256}`)
      .digest("hex");
    try {
      const asset = await deps.asset().upload({
        ...context,
        filename,
        mediaType: mediaType(filename),
        category: "sandbox-workspace",
        body,
        idempotencyKey,
      });
      await deps.publish({
        userId: context.userId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        conversationId: context.conversationId,
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
      });
    } finally {
      if (!body.locked) await body.cancel().catch(() => {});
    }
  }

  for (const [workspacePath, file] of baseline) {
    if (livePaths.has(workspacePath)) continue;
    await deps.delete({
      userId: context.userId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      conversationId: context.conversationId,
      fileId: file.id,
      workspacePath,
      expectedPathGeneration: file.path_generation,
      expectedEtag: file.etag,
      writerId: context.runId,
    });
  }
}
