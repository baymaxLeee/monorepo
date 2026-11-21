import { and, eq } from "drizzle-orm";

import { getDb } from "../infrastructure/persistence/index.js";
import { sandboxWorkspaceCheckout as checkout } from "../infrastructure/persistence/schema.js";
import type { SessionFile } from "./session-files.js";

export interface WorkspaceAttempt {
  runId: string;
  attemptEpoch: string;
}

export type WorkspaceCheckoutFile = Pick<
  SessionFile,
  "workspace_path" | "id" | "path_generation" | "etag" | "sha256" | "size"
>;

export async function readWorkspaceCheckout(scope: WorkspaceAttempt): Promise<WorkspaceCheckoutFile[]> {
  return getDb()
    .select({
      workspace_path: checkout.workspacePath,
      id: checkout.fileId,
      path_generation: checkout.pathGeneration,
      etag: checkout.etag,
      sha256: checkout.sha256,
      size: checkout.sizeBytes,
    })
    .from(checkout)
    .where(and(eq(checkout.turnId, scope.runId), eq(checkout.attemptEpoch, BigInt(scope.attemptEpoch))));
}

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function recordWorkspaceCheckout(
  scope: WorkspaceAttempt,
  file: WorkspaceCheckoutFile,
  db: Transaction | ReturnType<typeof getDb> = getDb(),
) {
  const version = {
    fileId: file.id,
    pathGeneration: file.path_generation,
    etag: file.etag,
    sha256: file.sha256,
    sizeBytes: file.size,
  };
  await db
    .insert(checkout)
    .values({
      turnId: scope.runId,
      attemptEpoch: BigInt(scope.attemptEpoch),
      workspacePath: file.workspace_path,
      ...version,
    })
    .onConflictDoUpdate({ target: [checkout.turnId, checkout.attemptEpoch, checkout.workspacePath], set: version });
}
