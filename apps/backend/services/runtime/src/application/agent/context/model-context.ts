import { createHash } from "node:crypto";

import {
  projectRuntimeContext,
  parseCheckpointState,
  type RuntimeContextCheckpointWrite,
  type RuntimeTokenUsage,
} from "@repo/agent-runtime";
import type { ToolSet, UIMessage } from "ai";
import { and, asc, eq } from "drizzle-orm";

import { createProviderModel, type LanguageProviderSnapshot } from "#runtime/provider-model";

import { getDb } from "../../../infrastructure/persistence/index.js";
import { contextCheckpoints, threadFiles } from "../../../infrastructure/persistence/schema.js";
import { ConflictError } from "../../errors.js";
import { withRunLease, type RunLeaseToken, type RuntimeTransaction } from "../runs/repository.js";
import { transformFilePartsForModel } from "./model-files.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

export const CONTEXT_COMPACTOR_VERSION = "runtime-context-projection-v1";

export interface ContextProjectionBinding {
  historyRevision: number;
  historyDigest: string;
  instructionDigest: string;
  toolCatalogDigest: string;
  workspaceDigest: string;
  compactorVersion: string;
  remoteBinding: string | null;
}

export type ExpectedContextGeneration = Pick<
  ContextProjectionBinding,
  "instructionDigest" | "toolCatalogDigest" | "workspaceDigest" | "compactorVersion" | "remoteBinding"
>;

export function assertContextGeneration(
  binding: ContextProjectionBinding,
  expected: ExpectedContextGeneration | undefined,
): void {
  if (
    expected &&
    (binding.instructionDigest !== expected.instructionDigest ||
      binding.toolCatalogDigest !== expected.toolCatalogDigest ||
      binding.workspaceDigest !== expected.workspaceDigest ||
      binding.compactorVersion !== expected.compactorVersion ||
      binding.remoteBinding !== expected.remoteBinding)
  ) {
    throw new ConflictError(
      "turn recovery generation no longer matches its resume envelope",
      "resume_generation_conflict",
    );
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function messageDigest(messages: AnyUIMessage[]): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(messages)))
    .digest("hex");
}

async function saveCheckpoint(
  db: RuntimeTransaction,
  sessionId: string,
  binding: ContextProjectionBinding,
  checkpoint: RuntimeContextCheckpointWrite,
): Promise<void> {
  const now = new Date();
  if (checkpoint.expectedRevision != null) {
    const updated = await db
      .update(contextCheckpoints)
      .set({
        revision: BigInt(checkpoint.expectedRevision + 1),
        coveredItemId: checkpoint.coveredThroughMessageId,
        summary: "summary" in checkpoint.state ? checkpoint.state.summary : "",
        stateJson: checkpoint.state as unknown as Record<string, unknown>,
        sourceHistoryRevision: BigInt(binding.historyRevision),
        sourceHistoryDigest: binding.historyDigest,
        instructionDigest: binding.instructionDigest,
        toolCatalogDigest: binding.toolCatalogDigest,
        workspaceDigest: binding.workspaceDigest,
        compactorVersion: binding.compactorVersion,
        remoteBinding: binding.remoteBinding,
        estimatedTokens: checkpoint.estimatedTokens,
        updatedAt: now,
      })
      .where(
        and(
          eq(contextCheckpoints.threadId, sessionId),
          eq(contextCheckpoints.revision, BigInt(checkpoint.expectedRevision)),
        ),
      )
      .returning({ revision: contextCheckpoints.revision });
    if (updated.length !== 1) throw new Error("session context checkpoint revision conflict");
    return;
  }
  await db.insert(contextCheckpoints).values({
    threadId: sessionId,
    revision: 1n,
    coveredItemId: checkpoint.coveredThroughMessageId,
    summary: "summary" in checkpoint.state ? checkpoint.state.summary : "",
    stateJson: checkpoint.state as unknown as Record<string, unknown>,
    sourceHistoryRevision: BigInt(binding.historyRevision),
    sourceHistoryDigest: binding.historyDigest,
    instructionDigest: binding.instructionDigest,
    toolCatalogDigest: binding.toolCatalogDigest,
    workspaceDigest: binding.workspaceDigest,
    compactorVersion: binding.compactorVersion,
    remoteBinding: binding.remoteBinding,
    estimatedTokens: checkpoint.estimatedTokens,
    createdAt: now,
    updatedAt: now,
  });
}

export async function projectModelContext(input: {
  owner: RunLeaseToken;
  sessionId: string;
  provider: LanguageProviderSnapshot & { supportsImageInput: boolean };
  historyRevision: number;
  historyDigest: string;
  instructionDigest: string;
  toolCatalogDigest: string;
  abortSignal: AbortSignal;
  previousInputTokens?: number;
  remoteBinding?: string;
  instructions?: Parameters<typeof projectRuntimeContext>[0]["instructions"];
  messages: AnyUIMessage[];
  tools: ToolSet;
  onCompactionUsage?: (usage: RuntimeTokenUsage) => void;
  compactionRetry?: Parameters<typeof projectRuntimeContext>[0]["compactionRetry"];
  onCompaction?: Parameters<typeof projectRuntimeContext>[0]["onCompaction"];
  expectedGeneration?: ExpectedContextGeneration;
}) {
  const workspaceRows = await getDb()
    .select({
      path: threadFiles.workspacePath,
      pathGeneration: threadFiles.pathGeneration,
      contentGeneration: threadFiles.contentGeneration,
      sha256: threadFiles.sha256,
    })
    .from(threadFiles)
    .where(and(eq(threadFiles.threadId, input.sessionId), eq(threadFiles.workspaceState, "live")))
    .orderBy(asc(threadFiles.workspacePath));
  const workspaceDigest = createHash("sha256")
    .update(
      JSON.stringify(
        workspaceRows.map((row) => [
          row.path,
          row.pathGeneration.toString(),
          row.contentGeneration.toString(),
          row.sha256,
        ]),
      ),
    )
    .digest("hex");
  const binding: ContextProjectionBinding = {
    historyRevision: input.historyRevision,
    historyDigest: input.historyDigest,
    instructionDigest: input.instructionDigest,
    toolCatalogDigest: input.toolCatalogDigest,
    workspaceDigest,
    compactorVersion: CONTEXT_COMPACTOR_VERSION,
    remoteBinding: input.remoteBinding ?? null,
  };
  assertContextGeneration(binding, input.expectedGeneration);
  const [stored] = await getDb()
    .select()
    .from(contextCheckpoints)
    .where(eq(contextCheckpoints.threadId, input.sessionId));
  const state = parseCheckpointState(stored?.stateJson);
  const storedCoveredIndex = stored ? input.messages.findIndex((message) => message.id === stored.coveredItemId) : -1;
  const storedHistoryDigest =
    storedCoveredIndex >= 0 ? messageDigest(input.messages.slice(0, storedCoveredIndex + 1)) : null;
  const checkpoint =
    stored &&
    stored.coveredItemId &&
    state &&
    stored.sourceHistoryRevision <= BigInt(binding.historyRevision) &&
    stored.sourceHistoryDigest === storedHistoryDigest &&
    stored.instructionDigest === binding.instructionDigest &&
    stored.toolCatalogDigest === binding.toolCatalogDigest &&
    stored.workspaceDigest === binding.workspaceDigest &&
    stored.compactorVersion === binding.compactorVersion &&
    (stored.remoteBinding ?? null) === binding.remoteBinding
      ? {
          revision: Number(stored.revision),
          coveredThroughMessageId: stored.coveredItemId,
          state,
        }
      : null;
  const projected = await projectRuntimeContext({
    messages: input.messages,
    tools: input.tools,
    model: createProviderModel(input.provider),
    limits: input.provider,
    previousInputTokens: input.previousInputTokens,
    remoteBinding: input.remoteBinding,
    instructions: input.instructions,
    checkpoint,
    signal: input.abortSignal,
    onCompactionUsage: input.onCompactionUsage,
    compactionRetry: input.compactionRetry,
    onCompaction: input.onCompaction,
    saveCheckpoint: (next) => {
      const coveredIndex = input.messages.findIndex((message) => message.id === next.coveredThroughMessageId);
      if (coveredIndex < 0) throw new Error("context checkpoint is outside the selected journal history");
      return withRunLease(input.owner, (tx) =>
        saveCheckpoint(
          tx,
          input.sessionId,
          { ...binding, historyDigest: messageDigest(input.messages.slice(0, coveredIndex + 1)) },
          next,
        ),
      );
    },
    prepareRecent: (messages) =>
      transformFilePartsForModel(messages, {
        sessionId: input.sessionId,
        supportsImageInput: input.provider.supportsImageInput,
        signal: input.abortSignal,
      }),
  });
  return { ...projected, binding, compacted: checkpoint !== null || projected.checkpointAdvanced };
}
