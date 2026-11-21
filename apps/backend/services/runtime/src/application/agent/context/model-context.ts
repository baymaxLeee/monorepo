import {
  projectRuntimeContext,
  parseCheckpointState,
  type RuntimeContextCheckpointWrite,
  type RuntimeTokenUsage,
} from "@repo/agent-runtime";
import type { ToolSet, UIMessage } from "ai";
import { and, eq } from "drizzle-orm";

import { createProviderModel, type LanguageProviderSnapshot } from "#runtime/provider-model";

import { getDb } from "../../../infrastructure/persistence/index.js";
import { contextCheckpoints } from "../../../infrastructure/persistence/schema.js";
import { withRunLease, type RunLeaseToken, type RuntimeTransaction } from "../runs/repository.js";
import { transformFilePartsForModel } from "./model-files.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

async function saveCheckpoint(
  db: RuntimeTransaction,
  sessionId: string,
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
    estimatedTokens: checkpoint.estimatedTokens,
    createdAt: now,
    updatedAt: now,
  });
}

export async function projectModelContext(input: {
  owner: RunLeaseToken;
  sessionId: string;
  userId: string;
  tenantId: string;
  workspaceId: string;
  provider: LanguageProviderSnapshot & { supportsImageInput: boolean };
  abortSignal: AbortSignal;
  previousInputTokens?: number;
  remoteBinding?: string;
  instructions?: Parameters<typeof projectRuntimeContext>[0]["instructions"];
  messages: AnyUIMessage[];
  tools: ToolSet;
  onCompactionUsage?: (usage: RuntimeTokenUsage) => void;
}) {
  const [stored] = await getDb()
    .select()
    .from(contextCheckpoints)
    .where(eq(contextCheckpoints.threadId, input.sessionId));
  const state = parseCheckpointState(stored?.stateJson);
  const checkpoint =
    stored && stored.coveredItemId && state
      ? {
          revision: Number(stored.revision),
          coveredThroughMessageId: stored.coveredItemId,
          state,
        }
      : null;
  return projectRuntimeContext({
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
    saveCheckpoint: (next) => withRunLease(input.owner, (tx) => saveCheckpoint(tx, input.sessionId, next)),
    prepareRecent: (messages) =>
      transformFilePartsForModel(messages, {
        userId: input.userId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        supportsImageInput: input.provider.supportsImageInput,
        signal: input.abortSignal,
      }),
  });
}
