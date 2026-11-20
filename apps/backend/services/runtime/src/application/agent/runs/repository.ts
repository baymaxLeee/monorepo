import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { toPersistedTurnPluginSnapshot } from "@repo/agent-runtime/plugins/snapshot";
import type {
  PersistedTurnPluginSnapshot,
  PluginActivation,
  ResolvedTurnPluginSnapshot,
} from "@repo/agent-runtime/plugins/types";
import { isToolOutcome } from "@repo/agent-runtime/tools/outcome";
import type { UIMessage } from "ai";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, notExists, or, sql } from "drizzle-orm";

import { getDb } from "../../../infrastructure/persistence/index.js";
import {
  contextCheckpoints,
  threadItems,
  threads,
  toolExecutions,
  turnInputs,
  turnLeases,
  turnPluginSnapshots,
  turns,
  turnSteps,
} from "../../../infrastructure/persistence/schema.js";
import type { PersistedThreadItemContent } from "../../../infrastructure/persistence/schema.js";
import { ConflictError, RequestError } from "../../errors.js";
import { parseSessionContextSnapshot, type SessionContextSnapshot } from "../context/context-snapshot.js";
import { cancelTodoOutput, finalizeCancelledParts } from "./cancellation.js";
import { mergeClientContinuation } from "./continuation.js";

export type AgentRunStatus = "running" | "cancel_requested" | "completed" | "failed" | "cancelled" | "interrupted";
export type AgentStepStatus = "running" | "completed" | "failed";
export const RUN_LEASE_MS = 10 * 60_000;
export type AgentRunOperation = "submit-message" | "edit-message" | "regenerate-message" | "tool-continuation";

export interface ClaimedAgentRun {
  runId: string;
  attemptEpoch: bigint;
  duplicate: boolean;
  historyRevision: number;
  historyMessageId: string;
  inputMessageId: string | null;
}

export interface RunLeaseToken {
  runId: string;
  attemptEpoch: bigint;
}

type RuntimeTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function requireOwnedRun(
  tx: RuntimeTransaction,
  token: RunLeaseToken,
  options: { allowTerminal?: boolean } = {},
): Promise<typeof turns.$inferSelect> {
  const [run] = await tx.select().from(turns).where(eq(turns.id, token.runId));
  if (!run || run.attemptEpoch !== token.attemptEpoch) {
    throw new ConflictError("agent run ownership was lost", "run_lease_lost");
  }
  if (options.allowTerminal && ["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
    return run;
  }
  const now = new Date();
  const [lease] = await tx
    .select({ turnId: turnLeases.turnId })
    .from(turnLeases)
    .where(
      and(
        eq(turnLeases.turnId, token.runId),
        eq(turnLeases.attemptEpoch, token.attemptEpoch),
        gt(turnLeases.expiresAt, now),
      ),
    )
    .for("update");
  if (!lease || !["running", "cancel_requested"].includes(run.status)) {
    throw new ConflictError("agent run ownership was lost", "run_lease_lost");
  }
  return run;
}

export function withRunLease<T>(token: RunLeaseToken, operation: (tx: RuntimeTransaction) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, token);
    return operation(tx);
  });
}

export async function assertRunLease(token: RunLeaseToken): Promise<void> {
  await getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, token);
  });
}

function id(bytes = 8): string {
  return randomBytes(bytes).toString("hex");
}

function asJsonValue(value: unknown): unknown {
  if (value == null) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export async function createAgentRun(input: {
  sessionId: string;
  userId: string;
  providerId: string;
  model: string;
  inputMessageId?: string | null;
}): Promise<string> {
  const now = new Date();
  const runId = id(16);
  await getDb().transaction(async (tx) => {
    const [thread] = await tx.select().from(threads).where(eq(threads.id, input.sessionId)).for("update");
    if (!thread) throw new Error(`thread ${input.sessionId} does not exist`);
    const ordinal = thread.turnSequence + 1n;
    await tx.insert(turns).values({
      id: runId,
      threadId: input.sessionId,
      ordinal,
      userId: input.userId,
      providerId: input.providerId,
      model: input.model,
      status: "running",
      inputItemId: input.inputMessageId ?? null,
      createdAt: now,
      startedAt: now,
    });
    await tx.update(threads).set({ turnSequence: ordinal, updatedAt: now }).where(eq(threads.id, input.sessionId));
  });
  return runId;
}

export async function readAgentRunPluginSnapshot(token: RunLeaseToken): Promise<PersistedTurnPluginSnapshot | null> {
  return getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, token);
    const [record] = await tx
      .select({ snapshot: turnPluginSnapshots.snapshot })
      .from(turnPluginSnapshots)
      .where(eq(turnPluginSnapshots.turnId, token.runId));
    return record?.snapshot ?? null;
  });
}

/** Persist a Turn's immutable plugin projection without ever crossing the grant/credential boundary. */
export async function persistAgentRunPluginSnapshot(
  token: RunLeaseToken,
  resolved: ResolvedTurnPluginSnapshot,
): Promise<PersistedTurnPluginSnapshot> {
  const snapshot = toPersistedTurnPluginSnapshot(resolved);
  return getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, token);
    const inserted = await tx
      .insert(turnPluginSnapshots)
      .values({ turnId: token.runId, snapshot, createdAt: new Date() })
      .onConflictDoNothing({ target: turnPluginSnapshots.turnId })
      .returning({ turnId: turnPluginSnapshots.turnId });
    if (inserted.length > 0) return snapshot;

    const [existing] = await tx
      .select({ snapshot: turnPluginSnapshots.snapshot })
      .from(turnPluginSnapshots)
      .where(eq(turnPluginSnapshots.turnId, token.runId));
    if (!existing) throw new Error(`agent run ${token.runId} plugin snapshot could not be persisted`);
    if (!isDeepStrictEqual(existing.snapshot, snapshot)) {
      throw new Error(`agent run ${token.runId} plugin snapshot is immutable`);
    }
    return existing.snapshot;
  });
}

export async function claimAgentRunOperation(input: {
  sessionId: string;
  userId: string;
  providerId: string;
  model: string;
  requestId: string;
  expectedRevision: number;
  operation: AgentRunOperation;
  targetMessageId?: string | null;
  continuationMessage?: UIMessage<unknown, any, any>;
  requestContext?: { reasoningEffort?: string; pluginActivations?: PluginActivation[] };
  inputMessage?: {
    id: string;
    role: "user";
    content: PersistedThreadItemContent;
  };
}): Promise<ClaimedAgentRun> {
  const db = getDb();
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, child]) => child !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, canonical(child)]),
          )
        : value;
  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify(canonical(input)))
    .digest("hex");
  return db.transaction(async (tx) => {
    const findExisting = async () => {
      const [existing] = await tx
        .select()
        .from(turns)
        .where(and(eq(turns.threadId, input.sessionId), eq(turns.requestId, input.requestId)))
        .limit(1);
      if (!existing) return null;
      if (
        existing.userId !== input.userId ||
        existing.requestFingerprint !== requestFingerprint ||
        existing.operation !== input.operation ||
        (existing.targetItemId ?? null) !== (input.targetMessageId ?? null)
      ) {
        throw new ConflictError("request_id is already bound to a different chat operation", "request_id_conflict");
      }
      if (!existing.historyItemId || existing.historyRevision == null) {
        throw new Error(`agent run ${existing.id} is missing its history binding`);
      }
      return {
        runId: existing.id,
        attemptEpoch: existing.attemptEpoch,
        duplicate: true,
        historyRevision: Number(existing.historyRevision),
        historyMessageId: existing.historyItemId,
        inputMessageId: existing.inputItemId,
      } satisfies ClaimedAgentRun;
    };

    const beforeLock = await findExisting();
    if (beforeLock) return beforeLock;

    const [session] = await tx.select().from(threads).where(eq(threads.id, input.sessionId)).for("update");
    if (!session || session.userId !== input.userId) {
      throw new RequestError("session does not belong to this user");
    }

    const afterLock = await findExisting();
    if (afterLock) return afterLock;
    if (session.historyRevision !== BigInt(input.expectedRevision)) {
      throw new ConflictError("session history revision is stale", "history_revision_conflict", {
        expected_revision: input.expectedRevision,
        current_revision: Number(session.historyRevision),
      });
    }

    const rows = await tx
      .select({
        id: threadItems.id,
        turnId: threadItems.turnId,
        parentMessageId: threadItems.parentItemId,
        role: threadItems.role,
        branchIndex: threadItems.branchIndex,
        content: threadItems.content,
        status: threadItems.status,
      })
      .from(threadItems)
      .where(eq(threadItems.threadId, input.sessionId));
    const now = new Date();
    const [activeLease] = await tx.select().from(turnLeases).where(eq(turnLeases.threadId, input.sessionId));
    if (activeLease && activeLease.expiresAt > now) {
      throw new ConflictError("this session already has an active run", "active_run_exists", {
        run_id: activeLease.turnId,
      });
    }
    if (activeLease) {
      await tx.delete(turnLeases).where(eq(turnLeases.turnId, activeLease.turnId));
      await tx
        .update(turns)
        .set({ status: "interrupted", completedAt: now, error: "turn lease expired" })
        .where(and(eq(turns.id, activeLease.turnId), inArray(turns.status, ["running", "cancel_requested"])));
    }
    const byId = new Map(rows.map((row) => [row.id, row] as const));
    const selectedIds = new Set<string>();
    let selected = session.selectedItemId ? byId.get(session.selectedItemId) : undefined;
    while (selected) {
      if (selectedIds.has(selected.id)) throw new Error("selected message history contains a cycle");
      selectedIds.add(selected.id);
      selected = selected.parentMessageId ? byId.get(selected.parentMessageId) : undefined;
    }

    const target = input.targetMessageId ? byId.get(input.targetMessageId) : undefined;
    if (input.targetMessageId && (!target || !selectedIds.has(target.id))) {
      throw new ConflictError("target message is not on the selected history", "history_target_conflict");
    }

    let historyMessageId: string;
    let inputMessageId: string | null = null;
    let selectedMessageId = session.selectedItemId;
    if (input.operation === "submit-message" || input.operation === "edit-message") {
      if (!input.inputMessage) throw new RequestError("user message is required for this operation");
      if (byId.has(input.inputMessage.id)) {
        throw new ConflictError("user message id already exists", "message_id_conflict");
      }
      if (input.operation === "edit-message" && (!target || target.role !== "user")) {
        throw new RequestError("edited message must target a selected user message");
      }
      const parentMessageId =
        input.operation === "edit-message" ? (target?.parentMessageId ?? null) : session.selectedItemId;
      const branchIndex = rows
        .filter((row) => row.parentMessageId === parentMessageId)
        .reduce((maximum, row) => Math.max(maximum, row.branchIndex + 1), 0);
      const inputOrdinal = session.itemSequence + 1n;
      await tx.insert(threadItems).values({
        id: input.inputMessage.id,
        threadId: input.sessionId,
        ordinal: inputOrdinal,
        role: "user",
        content: input.inputMessage.content,
        status: "ok",
        parentItemId: parentMessageId,
        branchIndex,
        createdAt: now,
        updatedAt: now,
      });
      historyMessageId = input.inputMessage.id;
      inputMessageId = input.inputMessage.id;
      selectedMessageId = input.inputMessage.id;
    } else if (input.operation === "regenerate-message") {
      if (!target || target.role !== "assistant" || !target.parentMessageId) {
        throw new RequestError("regeneration must target a selected assistant message with parent history");
      }
      historyMessageId = target.parentMessageId;
    } else {
      if (!target || target.role !== "assistant" || session.selectedItemId !== target.id) {
        throw new RequestError("tool continuation must target the selected assistant message");
      }
      if (!input.continuationMessage || target.status !== "ok") {
        throw new RequestError("tool continuation requires a completed assistant message and client response");
      }
      const merged = mergeClientContinuation(
        {
          id: target.id,
          role: "assistant",
          parts: target.content.parts as UIMessage<unknown, any, any>["parts"],
          ...(target.content.metadata ? { metadata: target.content.metadata } : {}),
        },
        input.continuationMessage,
      );
      await tx
        .update(threadItems)
        .set({
          content: { ...target.content, parts: merged.parts },
          revision: sql`${threadItems.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(threadItems.id, target.id));
      historyMessageId = target.id;
    }

    const historyRevision = input.expectedRevision + 1;
    const runId = id(16);
    const turnOrdinal = session.turnSequence + 1n;
    await tx.insert(turns).values({
      id: runId,
      threadId: input.sessionId,
      ordinal: turnOrdinal,
      userId: input.userId,
      providerId: input.providerId,
      model: input.model,
      status: "running",
      requestId: input.requestId,
      requestFingerprint,
      operation: input.operation,
      targetItemId: input.targetMessageId ?? null,
      historyItemId: historyMessageId,
      historyRevision: BigInt(historyRevision),
      inputItemId: inputMessageId,
      createdAt: now,
      startedAt: now,
    });
    if (input.operation === "tool-continuation") {
      const [source] = target?.turnId
        ? await tx
            .select({ snapshot: turnPluginSnapshots.snapshot })
            .from(turnPluginSnapshots)
            .innerJoin(turns, eq(turns.id, turnPluginSnapshots.turnId))
            .where(and(eq(turns.threadId, input.sessionId), eq(turns.id, target.turnId)))
        : [];
      if (!source)
        throw new ConflictError("tool continuation has no frozen plugin snapshot", "plugin_snapshot_missing");
      await tx.insert(turnPluginSnapshots).values({ turnId: runId, snapshot: source.snapshot, createdAt: now });
    }
    await tx.insert(turnLeases).values({
      threadId: input.sessionId,
      turnId: runId,
      attemptEpoch: 1n,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + RUN_LEASE_MS),
    });
    await tx
      .update(threads)
      .set({
        turnSequence: turnOrdinal,
        itemSequence: inputMessageId ? session.itemSequence + 1n : session.itemSequence,
        historyRevision: BigInt(historyRevision),
        selectedItemId: selectedMessageId,
        updatedAt: now,
      })
      .where(eq(threads.id, input.sessionId));
    return { runId, attemptEpoch: 1n, duplicate: false, historyRevision, historyMessageId, inputMessageId };
  });
}

export async function getAgentRunById(runId: string): Promise<{
  id: string;
  sessionId: string;
  userId: string;
  providerId: string;
  status: AgentRunStatus;
  requestId: string | null;
  operation: AgentRunOperation | null;
  targetMessageId: string | null;
  historyMessageId: string | null;
  historyRevision: number | null;
} | null> {
  const [row] = await getDb().select().from(turns).where(eq(turns.id, runId));
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    sessionId: row.threadId,
    userId: row.userId,
    providerId: row.providerId,
    status: row.status as AgentRunStatus,
    requestId: row.requestId,
    operation: row.operation as AgentRunOperation | null,
    targetMessageId: row.targetItemId,
    historyMessageId: row.historyItemId,
    historyRevision: row.historyRevision == null ? null : Number(row.historyRevision),
  };
}

export async function finishAgentRun(input: {
  runId: string;
  attemptEpoch: bigint;
  status: AgentRunStatus;
  error?: unknown;
  outputMessageId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [binding] = await tx.select({ threadId: turns.threadId }).from(turns).where(eq(turns.id, input.runId));
    if (!binding) return;
    await tx.select({ id: threads.id }).from(threads).where(eq(threads.id, binding.threadId)).for("update");
    const [run] = await tx.select().from(turns).where(eq(turns.id, input.runId)).for("update");
    if (!run) return;
    if (run.attemptEpoch !== input.attemptEpoch) {
      throw new ConflictError("agent run ownership was lost", "run_lease_lost");
    }
    if (!["running", "cancel_requested"].includes(run.status)) {
      return;
    }
    await requireOwnedRun(tx, input);
    const { status, error } = input;
    const now = new Date();

    await tx
      .update(turnSteps)
      .set({
        status: "failed",
        summary:
          status === "completed"
            ? "run completed without a recorded trace step completion"
            : error == null
              ? `run ${status}`
              : errorText(error).slice(0, 4000),
        completedAt: now,
      })
      .where(and(eq(turnSteps.turnId, input.runId), eq(turnSteps.status, "running")));

    await tx
      .update(turns)
      .set({
        status,
        error: error == null ? null : errorText(error).slice(0, 4000),
        outputItemId: input.outputMessageId ?? undefined,
        inputTokens: input.inputTokens ?? undefined,
        outputTokens: input.outputTokens ?? undefined,
        cachedInputTokens: input.cachedInputTokens ?? undefined,
        reasoningTokens: input.reasoningTokens ?? undefined,
        totalTokens: input.totalTokens ?? undefined,
        completedAt: now,
      })
      .where(eq(turns.id, input.runId));
    await tx
      .update(turnInputs)
      .set({ state: "not_delivered", reason: "finished", updatedAt: now })
      .where(and(eq(turnInputs.turnId, input.runId), eq(turnInputs.state, "accepted")));
    await tx
      .update(turnInputs)
      .set({ state: "unconfirmed", reason: "run ended before delivery was confirmed", updatedAt: now })
      .where(and(eq(turnInputs.turnId, input.runId), eq(turnInputs.state, "dispatching")));
    await tx
      .delete(turnLeases)
      .where(and(eq(turnLeases.turnId, input.runId), eq(turnLeases.attemptEpoch, input.attemptEpoch)));
  });
}

export async function finalizeAgentRunJournal(input: {
  runId: string;
  attemptEpoch: bigint;
  parts: unknown[];
  aborted: boolean;
  message: {
    id: string;
    content: PersistedThreadItemContent;
    status: "ok" | "failed";
  } | null;
  status: AgentRunStatus;
  error?: unknown;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
}): Promise<{ outputMessageId: string | null; historyRevision: number; status: AgentRunStatus }> {
  return getDb().transaction(async (tx) => {
    const [binding] = await tx.select({ threadId: turns.threadId }).from(turns).where(eq(turns.id, input.runId));
    if (!binding) throw new Error(`agent run ${input.runId} has no journal binding`);
    // Claim and finalization must acquire shared rows in the same order.
    // Otherwise an expired lease claim can deadlock with its old finalizer.
    const [session] = await tx
      .select({ historyRevision: threads.historyRevision, itemSequence: threads.itemSequence })
      .from(threads)
      .where(eq(threads.id, binding.threadId))
      .for("update");
    const [run] = await tx.select().from(turns).where(eq(turns.id, input.runId)).for("update");
    if (!run || !run.operation || !run.historyItemId || run.historyRevision == null) {
      throw new Error(`agent run ${input.runId} has no journal binding`);
    }
    const historyRevision = Number(run.historyRevision);
    if (run.attemptEpoch !== input.attemptEpoch) {
      throw new ConflictError("agent run ownership was lost", "run_lease_lost");
    }
    if (["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
      return { outputMessageId: run.outputItemId, historyRevision, status: run.status as AgentRunStatus };
    }
    await requireOwnedRun(tx, input);

    if (!session || session.historyRevision !== run.historyRevision) {
      throw new ConflictError("run history binding is no longer current", "run_history_conflict");
    }

    const now = new Date();
    const aborted = input.aborted || run.status === "cancel_requested" || input.status === "cancelled";
    const status = aborted ? "cancelled" : input.status;
    const error = input.error;
    const message = input.message
      ? {
          ...input.message,
          status: status === "completed" ? "ok" : "failed",
          content: {
            ...input.message.content,
            parts: aborted
              ? finalizeCancelledParts(input.message.content.parts as UIMessage<unknown, any, any>["parts"])
              : input.message.content.parts,
            ...(input.message.content.metadata
              ? {
                  metadata: {
                    ...input.message.content.metadata,
                    status: status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
                  },
                }
              : {}),
          },
        }
      : null;
    const toolCalls = await tx.select().from(toolExecutions).where(eq(toolExecutions.turnId, input.runId));
    if (aborted) {
      for (const toolCall of toolCalls) {
        if (toolCall.status === "running") {
          await tx
            .update(toolExecutions)
            .set({
              status: "failed",
              error: "已取消。",
              durationMs: Math.max(0, now.getTime() - toolCall.createdAt.getTime()),
              completedAt: now,
              itemId: message?.id ?? null,
            })
            .where(eq(toolExecutions.id, toolCall.id));
        } else if (toolCall.toolName === "update_todos" && toolCall.status === "completed") {
          await tx
            .update(toolExecutions)
            .set({ outputJson: cancelTodoOutput(toolCall.outputJson), itemId: message?.id ?? null })
            .where(eq(toolExecutions.id, toolCall.id));
        }
      }
    } else {
      const terminalById = new Map<string, NonNullable<ReturnType<typeof terminalToolPart>>>();
      for (const part of input.parts) {
        const terminal = terminalToolPart(part);
        if (terminal) terminalById.set(terminal.toolCallId, terminal);
      }
      for (const toolCall of toolCalls) {
        if (toolCall.status !== "running") continue;
        const terminal = terminalById.get(toolCall.id);
        if (!terminal) continue;
        await tx
          .update(toolExecutions)
          .set({
            status: terminal.status,
            outputJson: terminal.output === undefined ? undefined : asJsonValue(terminal.output),
            error: terminal.status === "failed" ? errorText(terminal.error).slice(0, 4000) : null,
            durationMs: Math.max(0, now.getTime() - toolCall.createdAt.getTime()),
            completedAt: now,
            itemId: message?.id ?? null,
          })
          .where(eq(toolExecutions.id, toolCall.id));
      }
    }

    let outputMessageId: string | null = null;
    if (message) {
      if (run.operation === "tool-continuation") {
        if (message.id !== run.targetItemId) {
          throw new Error("continuation output message id does not match its target");
        }
        const updated = await tx
          .update(threadItems)
          .set({
            content: message.content,
            status: message.status,
            revision: sql`${threadItems.revision} + 1`,
            updatedAt: now,
          })
          .where(and(eq(threadItems.id, message.id), eq(threadItems.threadId, run.threadId)))
          .returning({ id: threadItems.id });
        if (!updated[0]) throw new Error(`continuation message ${message.id} is missing`);
        outputMessageId = message.id;
      } else {
        const siblings = await tx
          .select({ branchIndex: threadItems.branchIndex })
          .from(threadItems)
          .where(and(eq(threadItems.threadId, run.threadId), eq(threadItems.parentItemId, run.historyItemId)));
        const branchIndex = siblings.reduce((maximum, row) => Math.max(maximum, row.branchIndex + 1), 0);
        await tx.insert(threadItems).values({
          id: message.id,
          threadId: run.threadId,
          turnId: run.id,
          ordinal: session.itemSequence + 1n,
          role: "assistant",
          content: message.content,
          status: message.status,
          parentItemId: run.historyItemId,
          branchIndex,
          createdAt: now,
          updatedAt: now,
        });
        outputMessageId = message.id;
      }
      await tx.update(toolExecutions).set({ itemId: message.id }).where(eq(toolExecutions.turnId, input.runId));
    }

    // Trace gaps must not rewrite the authoritative SDK outcome.
    await tx
      .update(turnSteps)
      .set({
        status: "failed",
        summary:
          status === "completed"
            ? "run completed without a recorded trace step completion"
            : error == null
              ? `run ${status}`
              : errorText(error).slice(0, 4000),
        completedAt: now,
      })
      .where(and(eq(turnSteps.turnId, input.runId), eq(turnSteps.status, "running")));
    await tx
      .update(turns)
      .set({
        status,
        error: error == null ? null : errorText(error).slice(0, 4000),
        outputItemId: outputMessageId,
        inputTokens: input.inputTokens ?? undefined,
        outputTokens: input.outputTokens ?? undefined,
        cachedInputTokens: input.cachedInputTokens ?? undefined,
        reasoningTokens: input.reasoningTokens ?? undefined,
        totalTokens: input.totalTokens ?? undefined,
        completedAt: now,
      })
      .where(eq(turns.id, input.runId));
    await tx
      .update(threads)
      .set({
        ...(outputMessageId ? { selectedItemId: outputMessageId } : {}),
        ...(outputMessageId && run.operation !== "tool-continuation"
          ? { itemSequence: session.itemSequence + 1n }
          : {}),
        updatedAt: now,
      })
      .where(eq(threads.id, run.threadId));
    await tx
      .delete(turnLeases)
      .where(and(eq(turnLeases.turnId, input.runId), eq(turnLeases.attemptEpoch, input.attemptEpoch)));
    return { outputMessageId, historyRevision, status };
  });
}

export async function requestAgentRunCancellation(runId: string): Promise<void> {
  await getDb()
    .update(turns)
    .set({ status: "cancel_requested" })
    .where(and(eq(turns.id, runId), inArray(turns.status, ["running", "cancel_requested"])));
}

export async function isRunActive(runId: string): Promise<boolean> {
  const run = await getAgentRunById(runId);
  return run?.status === "running" || run?.status === "cancel_requested";
}

export async function listOrphanedRuns(now = new Date()): Promise<Array<{ id: string; sessionId: string }>> {
  return getDb()
    .select({ id: turns.id, sessionId: turns.threadId })
    .from(turns)
    .leftJoin(turnLeases, eq(turnLeases.turnId, turns.id))
    .where(
      and(
        inArray(turns.status, ["running", "cancel_requested"]),
        or(isNull(turnLeases.turnId), lte(turnLeases.expiresAt, now)),
      ),
    );
}

export async function interruptRuns(runIds: string[]): Promise<Array<{ id: string; sessionId: string }>> {
  if (runIds.length === 0) {
    return [];
  }
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const interrupted = await tx
      .update(turns)
      .set({ status: "interrupted", completedAt: now })
      .where(
        and(
          inArray(turns.id, runIds),
          inArray(turns.status, ["running", "cancel_requested"]),
          notExists(
            tx
              .select({ turnId: turnLeases.turnId })
              .from(turnLeases)
              .where(and(eq(turnLeases.turnId, turns.id), gt(turnLeases.expiresAt, now))),
          ),
        ),
      )
      .returning({ id: turns.id, sessionId: turns.threadId });
    const interruptedIds = interrupted.map((run) => run.id);
    if (interruptedIds.length === 0) return interrupted;
    await tx
      .update(turnInputs)
      .set({ state: "not_delivered", reason: "finished", updatedAt: now })
      .where(and(inArray(turnInputs.turnId, interruptedIds), eq(turnInputs.state, "accepted")));
    await tx
      .update(turnInputs)
      .set({ state: "unconfirmed", reason: "run ownership was lost before delivery was confirmed", updatedAt: now })
      .where(and(inArray(turnInputs.turnId, interruptedIds), eq(turnInputs.state, "dispatching")));
    return interrupted;
  });
}

export interface AgentTraceStep {
  id: string;
  stepIndex: number;
  kind: string;
  status: AgentStepStatus;
  summary: string | null;
  createdAt: string;
  finishedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  contextSnapshot: SessionContextSnapshot | null;
}

export interface AgentTraceToolCall {
  id: string;
  stepIndex: number | null;
  toolName: string;
  status: "running" | "completed" | "failed";
  durationMs: number | null;
  error: string | null;
}

export interface AgentRunTrace {
  runId: string;
  status: AgentRunStatus;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  contextWindow: number | null;
  steps: AgentTraceStep[];
  toolCalls: AgentTraceToolCall[];
}

export interface LatestSessionContextRecord {
  runId: string;
  stepId: string;
  providerId: string;
  model: string;
  cachedInputTokens: number | null;
  totalEstimated: boolean;
  updatedAt: string;
  snapshot: SessionContextSnapshot;
}

export async function getLatestResponseLineage(input: {
  runId: string;
  sessionId: string;
  providerId: string;
  model: string;
}): Promise<{ responseId: string; outputMessageId: string; inputTokens: number | null } | null> {
  const [latestRun] = await getDb()
    .select({
      id: turns.id,
      status: turns.status,
      outputMessageId: turns.outputItemId,
      providerId: turns.providerId,
      model: turns.model,
    })
    .from(turns)
    .where(and(ne(turns.id, input.runId), eq(turns.threadId, input.sessionId)))
    .orderBy(desc(turns.ordinal))
    .limit(1);
  if (
    latestRun?.status !== "completed" ||
    !latestRun.outputMessageId ||
    latestRun.providerId !== input.providerId ||
    latestRun.model !== input.model
  ) {
    return null;
  }
  const [[row], [outputMessage]] = await Promise.all([
    getDb()
      .select({ metadata: turnSteps.metadata, inputTokens: turnSteps.inputTokens, status: turnSteps.status })
      .from(turnSteps)
      .where(and(eq(turnSteps.turnId, latestRun.id), eq(turnSteps.kind, "model")))
      .orderBy(desc(turnSteps.stepIndex))
      .limit(1),
    getDb()
      .select({ content: threadItems.content })
      .from(threadItems)
      .where(eq(threadItems.id, latestRun.outputMessageId))
      .limit(1),
  ]);
  if (row?.status !== "completed") {
    return null;
  }
  const responseId = row?.metadata?.response_id;
  const journalResponseId = outputMessage?.content.metadata?.responseId;
  if (typeof responseId !== "string" || responseId !== journalResponseId) {
    return null;
  }
  return { responseId, outputMessageId: latestRun.outputMessageId, inputTokens: row.inputTokens ?? null };
}

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString().replace("+00:00", "Z") : null;
}

export async function getRunTrace(runId: string): Promise<AgentRunTrace | null> {
  const db = getDb();
  const [run] = await db.select().from(turns).where(eq(turns.id, runId));
  if (!run) {
    return null;
  }
  const steps = await db.select().from(turnSteps).where(eq(turnSteps.turnId, runId)).orderBy(asc(turnSteps.stepIndex));
  const toolCalls = await db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.turnId, runId))
    .orderBy(asc(toolExecutions.createdAt));
  return {
    runId: run.id,
    status: run.status as AgentRunStatus,
    model: run.model,
    inputTokens: run.inputTokens ?? null,
    outputTokens: run.outputTokens ?? null,
    cachedInputTokens: run.cachedInputTokens ?? null,
    reasoningTokens: run.reasoningTokens ?? null,
    totalTokens: run.totalTokens ?? null,
    contextWindow: null,
    steps: steps.map((s) => ({
      id: s.id,
      stepIndex: s.stepIndex,
      kind: s.kind,
      status: s.status as AgentStepStatus,
      summary: s.summary,
      createdAt: isoOrNull(s.createdAt) ?? "",
      finishedAt: isoOrNull(s.completedAt),
      inputTokens: s.inputTokens ?? null,
      outputTokens: s.outputTokens ?? null,
      totalTokens: s.totalTokens ?? null,
      contextSnapshot: parseSessionContextSnapshot(s.metadata?.context_snapshot),
    })),
    toolCalls: toolCalls.map((t) => ({
      id: t.id,
      stepIndex: t.stepIndex,
      toolName: t.toolName,
      status: t.status as "running" | "completed" | "failed",
      durationMs: t.durationMs,
      error: t.error,
    })),
  };
}

export async function getLatestSessionContextRecord(sessionId: string): Promise<LatestSessionContextRecord | null> {
  const [row] = await getDb()
    .select({
      runId: turns.id,
      stepId: turnSteps.id,
      providerId: turns.providerId,
      model: turns.model,
      metadata: turnSteps.metadata,
      inputTokens: turnSteps.inputTokens,
      runCreatedAt: turns.createdAt,
      finishedAt: turnSteps.completedAt,
    })
    .from(turnSteps)
    .innerJoin(turns, eq(turns.id, turnSteps.turnId))
    .where(
      and(
        eq(turns.threadId, sessionId),
        eq(turnSteps.kind, "model"),
        inArray(turnSteps.status, ["completed", "failed"]),
        sql`${turnSteps.metadata}->'context_snapshot' IS NOT NULL`,
      ),
    )
    .orderBy(
      desc(turns.ordinal),
      desc(sql<number>`CASE WHEN ${turnSteps.inputTokens} > 0 THEN 1 ELSE 0 END`),
      desc(turnSteps.stepIndex),
    )
    .limit(1);
  if (!row) {
    return null;
  }
  const snapshot = parseSessionContextSnapshot(row.metadata?.context_snapshot);
  if (!snapshot) {
    return null;
  }
  const usage = row.metadata?.usage;
  const inputDetails =
    usage && typeof usage === "object" ? (usage as { inputTokenDetails?: unknown }).inputTokenDetails : null;
  const cachedInputTokens =
    inputDetails && typeof inputDetails === "object"
      ? (inputDetails as { cacheReadTokens?: unknown }).cacheReadTokens
      : null;
  return {
    runId: row.runId,
    stepId: row.stepId,
    providerId: row.providerId,
    model: row.model,
    cachedInputTokens: typeof cachedInputTokens === "number" ? cachedInputTokens : null,
    totalEstimated: !(row.inputTokens != null && row.inputTokens > 0),
    updatedAt: isoOrNull(row.finishedAt) ?? isoOrNull(row.runCreatedAt) ?? "",
    snapshot,
  };
}

export async function hasSessionContextCheckpoint(sessionId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ threadId: contextCheckpoints.threadId })
    .from(contextCheckpoints)
    .where(eq(contextCheckpoints.threadId, sessionId))
    .limit(1);
  return row !== undefined;
}

export async function recordAgentStepContextSnapshot(
  token: RunLeaseToken,
  stepId: string,
  snapshot: SessionContextSnapshot,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, token);
    await tx
      .update(turnSteps)
      .set({
        metadata: sql`COALESCE(${turnSteps.metadata}, '{}'::jsonb) || jsonb_build_object('context_snapshot', ${JSON.stringify(snapshot)}::jsonb)`,
      })
      .where(and(eq(turnSteps.id, stepId), eq(turnSteps.turnId, token.runId)));
  });
}

export async function startAgentStep(input: {
  runId: string;
  attemptEpoch: bigint;
  stepIndex: number;
  kind: string;
  summary?: string;
  metadata?: Record<string, unknown> | null;
  stepId?: string;
}): Promise<string> {
  const stepId = input.stepId ?? id(16);
  await getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, input);
    await tx
      .insert(turnSteps)
      .values({
        id: stepId,
        turnId: input.runId,
        stepIndex: input.stepIndex,
        kind: input.kind,
        status: "running",
        summary: input.summary ?? null,
        metadata: input.metadata ?? null,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: turnSteps.id,
        set: {
          status: "running",
          summary: input.summary ?? null,
          metadata: input.metadata ?? null,
          completedAt: null,
        },
      });
  });
  return stepId;
}

export async function finishAgentStep(input: {
  runId: string;
  attemptEpoch: bigint;
  stepId: string;
  status: AgentStepStatus;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, input);
    await tx
      .update(turnSteps)
      .set({
        status: input.status,
        summary: input.summary ?? undefined,
        metadata: input.metadata ?? undefined,
        inputTokens: input.inputTokens ?? undefined,
        outputTokens: input.outputTokens ?? undefined,
        totalTokens: input.totalTokens ?? undefined,
        completedAt: new Date(),
      })
      .where(and(eq(turnSteps.id, input.stepId), eq(turnSteps.turnId, input.runId)));
  });
}

export async function recordToolCallStart(input: {
  runId: string;
  attemptEpoch: bigint;
  toolCallId: string;
  stepIndex?: number | null;
  toolName: string;
  toolInput: unknown;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, input);
    await tx
      .insert(toolExecutions)
      .values({
        id: input.toolCallId,
        turnId: input.runId,
        stepIndex: input.stepIndex ?? null,
        toolName: input.toolName,
        status: "running",
        inputJson: asJsonValue(input.toolInput),
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: toolExecutions.id,
        set: {
          turnId: input.runId,
          stepIndex: input.stepIndex ?? null,
          toolName: input.toolName,
          status: "running",
          inputJson: asJsonValue(input.toolInput),
          error: null,
          completedAt: null,
          durationMs: null,
          outputJson: sql`NULL`,
        },
      });
  });
}

export async function recordToolCallFinish(input: {
  runId: string;
  attemptEpoch: bigint;
  toolCallId: string;
  status: "completed" | "failed";
  output?: unknown;
  error?: unknown;
  durationMs?: number | null;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, input);
    await tx
      .update(toolExecutions)
      .set({
        status: input.status,
        outputJson: input.output === undefined ? undefined : asJsonValue(input.output),
        error: input.error == null ? null : errorText(input.error).slice(0, 4000),
        durationMs: input.durationMs ?? null,
        completedAt: new Date(),
      })
      .where(and(eq(toolExecutions.id, input.toolCallId), eq(toolExecutions.turnId, input.runId)));
  });
}

function terminalToolPart(part: unknown): {
  toolCallId: string;
  status: "completed" | "failed";
  output?: unknown;
  error?: unknown;
} | null {
  if (!part || typeof part !== "object") {
    return null;
  }
  const row = part as Record<string, unknown>;
  if (typeof row.toolCallId !== "string") {
    return null;
  }
  if (row.state === "output-available") {
    const output = row.output;
    const semanticFailure = isToolOutcome(output) && output.ok === false;
    return {
      toolCallId: row.toolCallId,
      status: semanticFailure ? "failed" : "completed",
      output,
      error: semanticFailure ? output.error.message : undefined,
    };
  }
  if (row.state === "output-error") {
    return {
      toolCallId: row.toolCallId,
      status: "failed",
      error: typeof row.errorText === "string" ? row.errorText : "tool execution failed",
    };
  }
  if (row.state === "output-denied") {
    return {
      toolCallId: row.toolCallId,
      status: "failed",
      error: "tool execution denied",
    };
  }
  return null;
}
