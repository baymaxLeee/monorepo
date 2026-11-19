import { parseRuntimeCompactionState, type RuntimeCompactionState } from "@repo/agent-runtime/context/compaction";
import { projectRuntimeContext, type RuntimeContextCheckpointWrite } from "@repo/agent-runtime/context/manager";
import type { RuntimeTokenUsage } from "@repo/agent-runtime/context/token-usage";
import type { UIMessage } from "ai";
import { and, eq } from "drizzle-orm";

import { createProviderModel, type LanguageProviderSnapshot } from "#runtime/provider-model";

import { getDb } from "../../../infrastructure/persistence/index.js";
import { sessionContexts } from "../../../infrastructure/persistence/schema.js";
import { transformFilePartsForModel } from "./model-files.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

async function saveCheckpoint(sessionId: string, checkpoint: RuntimeContextCheckpointWrite): Promise<void> {
  const db = getDb();
  const now = new Date();
  if (checkpoint.expectedRevision != null) {
    const updated = await db
      .update(sessionContexts)
      .set({
        revision: checkpoint.expectedRevision + 1,
        coveredThroughMessageId: checkpoint.coveredThroughMessageId,
        summary: checkpoint.state.summary,
        stateJson: checkpoint.state as unknown as Record<string, unknown>,
        estimatedTokens: checkpoint.estimatedTokens,
        updatedAt: now,
      })
      .where(and(eq(sessionContexts.sessionId, sessionId), eq(sessionContexts.revision, checkpoint.expectedRevision)))
      .returning({ revision: sessionContexts.revision });
    if (updated.length !== 1) throw new Error("session context checkpoint revision conflict");
    return;
  }
  await db.insert(sessionContexts).values({
    sessionId,
    revision: 1,
    coveredThroughMessageId: checkpoint.coveredThroughMessageId,
    summary: checkpoint.state.summary,
    stateJson: checkpoint.state as unknown as Record<string, unknown>,
    estimatedTokens: checkpoint.estimatedTokens,
    createdAt: now,
    updatedAt: now,
  });
}

export async function projectModelContext(input: {
  sessionId: string;
  userId: string;
  tenantId: string;
  workspaceId: string;
  provider: LanguageProviderSnapshot & { supportsImageInput: boolean };
  abortSignal: AbortSignal;
  messages: AnyUIMessage[];
  onCompactionUsage?: (usage: RuntimeTokenUsage) => void;
}) {
  const [stored] = await getDb().select().from(sessionContexts).where(eq(sessionContexts.sessionId, input.sessionId));
  const state = parseRuntimeCompactionState(stored?.stateJson);
  const checkpoint =
    stored && stored.coveredThroughMessageId && state
      ? {
          revision: stored.revision,
          coveredThroughMessageId: stored.coveredThroughMessageId,
          state: state satisfies RuntimeCompactionState,
        }
      : null;
  return projectRuntimeContext({
    messages: input.messages,
    model: createProviderModel(input.provider),
    limits: input.provider,
    checkpoint,
    signal: input.abortSignal,
    onCompactionUsage: input.onCompactionUsage,
    saveCheckpoint: (next) => saveCheckpoint(input.sessionId, next),
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
