import { createHash, randomBytes } from "node:crypto";

import { isToolOutcome } from "@backend/agent-runtime-ts/outcome";
import type { UIMessage } from "ai";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, notExists, or, sql } from "drizzle-orm";

import { getDb } from "../../../infrastructure/persistence/index.js";
import {
  agentRuns,
  agentSteeringInputs,
  agentSteps,
  agentToolCalls,
  conversations,
  conversationRunLeases,
  messages,
} from "../../../infrastructure/persistence/schema.js";
import type { PersistedMessageContent } from "../../../infrastructure/persistence/schema.js";
import { ConflictError, RequestError } from "../../errors.js";
import { parseConversationContextSnapshot, type ConversationContextSnapshot } from "../context/context-snapshot.js";
import { cancelTodoOutput, finalizeCancelledParts } from "./cancellation.js";
import { mergeClientContinuation } from "./continuation.js";

export type AgentRunStatus = "running" | "cancel_requested" | "completed" | "failed" | "cancelled" | "interrupted";
export type AgentStepStatus = "running" | "completed" | "failed";
export const RUN_LEASE_MS = 10 * 60_000;
export type AgentRunOperation = "submit-message" | "edit-message" | "regenerate-message" | "tool-continuation";

export interface ClaimedAgentRun {
  runId: string;
  duplicate: boolean;
  historyRevision: number;
  historyMessageId: string;
  inputMessageId: string | null;
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
  conversationId: string;
  userId: string;
  providerId: string;
  model: string;
  inputMessageId?: string | null;
}): Promise<string> {
  const now = new Date();
  const runId = id(16);
  await getDb()
    .insert(agentRuns)
    .values({
      id: runId,
      conversationId: input.conversationId,
      userId: input.userId,
      providerId: input.providerId,
      model: input.model,
      status: "running",
      inputMessageId: input.inputMessageId ?? null,
      createdAt: now,
      startedAt: now,
    });
  return runId;
}

export async function claimAgentRunOperation(input: {
  conversationId: string;
  userId: string;
  providerId: string;
  model: string;
  requestId: string;
  expectedRevision: number;
  operation: AgentRunOperation;
  targetMessageId?: string | null;
  continuationMessage?: UIMessage<unknown, any, any>;
  requestContext?: { agentId?: string | null; mode: "normal" | "plan" };
  inputMessage?: {
    id: string;
    role: "user";
    content: PersistedMessageContent;
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
        .from(agentRuns)
        .where(and(eq(agentRuns.conversationId, input.conversationId), eq(agentRuns.requestId, input.requestId)))
        .limit(1);
      if (!existing) return null;
      if (
        existing.userId !== input.userId ||
        existing.requestFingerprint !== requestFingerprint ||
        existing.operation !== input.operation ||
        (existing.targetMessageId ?? null) !== (input.targetMessageId ?? null)
      ) {
        throw new ConflictError("request_id is already bound to a different chat operation", "request_id_conflict");
      }
      if (!existing.historyMessageId || existing.historyRevision == null) {
        throw new Error(`agent run ${existing.id} is missing its history binding`);
      }
      return {
        runId: existing.id,
        duplicate: true,
        historyRevision: Number(existing.historyRevision),
        historyMessageId: existing.historyMessageId,
        inputMessageId: existing.inputMessageId,
      } satisfies ClaimedAgentRun;
    };

    const beforeLock = await findExisting();
    if (beforeLock) return beforeLock;

    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .for("update");
    if (!conversation || conversation.userId !== input.userId) {
      throw new RequestError("conversation does not belong to this user");
    }

    const afterLock = await findExisting();
    if (afterLock) return afterLock;
    if (conversation.historyRevision !== BigInt(input.expectedRevision)) {
      throw new ConflictError("conversation history revision is stale", "history_revision_conflict", {
        expected_revision: input.expectedRevision,
        current_revision: Number(conversation.historyRevision),
      });
    }

    const rows = await tx
      .select({
        id: messages.id,
        parentMessageId: messages.parentMessageId,
        role: messages.role,
        branchIndex: messages.branchIndex,
        content: messages.content,
        status: messages.status,
      })
      .from(messages)
      .where(eq(messages.conversationId, input.conversationId));
    const now = new Date();
    const [activeLease] = await tx
      .select()
      .from(conversationRunLeases)
      .where(eq(conversationRunLeases.conversationId, input.conversationId));
    if (activeLease && activeLease.expiresAt > now) {
      throw new ConflictError("this conversation already has an active run", "active_run_exists", {
        run_id: activeLease.runId,
      });
    }
    if (activeLease) {
      await tx.delete(conversationRunLeases).where(eq(conversationRunLeases.runId, activeLease.runId));
      await tx
        .update(agentRuns)
        .set({ status: "interrupted", finishedAt: now, error: "run lease expired" })
        .where(and(eq(agentRuns.id, activeLease.runId), inArray(agentRuns.status, ["running", "cancel_requested"])));
    }
    const byId = new Map(rows.map((row) => [row.id, row] as const));
    const selectedIds = new Set<string>();
    let selected = conversation.selectedMessageId ? byId.get(conversation.selectedMessageId) : undefined;
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
    let selectedMessageId = conversation.selectedMessageId;
    if (input.operation === "submit-message" || input.operation === "edit-message") {
      if (!input.inputMessage) throw new RequestError("user message is required for this operation");
      if (byId.has(input.inputMessage.id)) {
        throw new ConflictError("user message id already exists", "message_id_conflict");
      }
      if (input.operation === "edit-message" && (!target || target.role !== "user")) {
        throw new RequestError("edited message must target a selected user message");
      }
      const parentMessageId =
        input.operation === "edit-message" ? (target?.parentMessageId ?? null) : conversation.selectedMessageId;
      const branchIndex = rows
        .filter((row) => row.parentMessageId === parentMessageId)
        .reduce((maximum, row) => Math.max(maximum, row.branchIndex + 1), 0);
      await tx.insert(messages).values({
        id: input.inputMessage.id,
        conversationId: input.conversationId,
        role: "user",
        content: input.inputMessage.content,
        status: "ok",
        parentMessageId,
        branchIndex,
        createdAt: new Date(),
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
      if (!target || target.role !== "assistant" || conversation.selectedMessageId !== target.id) {
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
        .update(messages)
        .set({ content: { ...target.content, parts: merged.parts } })
        .where(eq(messages.id, target.id));
      historyMessageId = target.id;
    }

    const historyRevision = input.expectedRevision + 1;
    const runId = id(16);
    await tx.insert(agentRuns).values({
      id: runId,
      conversationId: input.conversationId,
      userId: input.userId,
      providerId: input.providerId,
      model: input.model,
      status: "running",
      requestId: input.requestId,
      requestFingerprint,
      operation: input.operation,
      targetMessageId: input.targetMessageId ?? null,
      historyMessageId,
      historyRevision: BigInt(historyRevision),
      inputMessageId,
      createdAt: now,
      startedAt: now,
    });
    await tx.insert(conversationRunLeases).values({
      conversationId: input.conversationId,
      runId,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + RUN_LEASE_MS),
    });
    await tx
      .update(conversations)
      .set({ historyRevision: BigInt(historyRevision), selectedMessageId, updatedAt: now })
      .where(eq(conversations.id, input.conversationId));
    return { runId, duplicate: false, historyRevision, historyMessageId, inputMessageId };
  });
}

export async function getAgentRunById(runId: string): Promise<{
  id: string;
  conversationId: string;
  userId: string;
  providerId: string;
  status: AgentRunStatus;
  requestId: string | null;
  operation: AgentRunOperation | null;
  targetMessageId: string | null;
  historyMessageId: string | null;
  historyRevision: number | null;
} | null> {
  const [row] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    userId: row.userId,
    providerId: row.providerId,
    status: row.status as AgentRunStatus,
    requestId: row.requestId,
    operation: row.operation as AgentRunOperation | null,
    targetMessageId: row.targetMessageId,
    historyMessageId: row.historyMessageId,
    historyRevision: row.historyRevision == null ? null : Number(row.historyRevision),
  };
}

export async function finishAgentRun(input: {
  runId: string;
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
    const [binding] = await tx
      .select({ conversationId: agentRuns.conversationId })
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId));
    if (!binding) return;
    await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, binding.conversationId))
      .for("update");
    const [run] = await tx.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).for("update");
    if (!run) return;
    if (!["running", "cancel_requested"].includes(run.status)) {
      await tx.delete(conversationRunLeases).where(eq(conversationRunLeases.runId, input.runId));
      return;
    }
    const { status, error } = input;
    const now = new Date();

    await tx
      .update(agentSteps)
      .set({
        status: "failed",
        summary:
          status === "completed"
            ? "run completed without a recorded trace step completion"
            : error == null
              ? `run ${status}`
              : errorText(error).slice(0, 4000),
        finishedAt: now,
      })
      .where(and(eq(agentSteps.runId, input.runId), eq(agentSteps.status, "running")));

    await tx
      .update(agentRuns)
      .set({
        status,
        error: error == null ? null : errorText(error).slice(0, 4000),
        outputMessageId: input.outputMessageId ?? undefined,
        inputTokens: input.inputTokens ?? undefined,
        outputTokens: input.outputTokens ?? undefined,
        cachedInputTokens: input.cachedInputTokens ?? undefined,
        reasoningTokens: input.reasoningTokens ?? undefined,
        totalTokens: input.totalTokens ?? undefined,
        finishedAt: now,
      })
      .where(eq(agentRuns.id, input.runId));
    await tx
      .update(agentSteeringInputs)
      .set({ state: "not_delivered", reason: "finished", updatedAt: now })
      .where(and(eq(agentSteeringInputs.runId, input.runId), eq(agentSteeringInputs.state, "accepted")));
    await tx
      .update(agentSteeringInputs)
      .set({ state: "unconfirmed", reason: "run ended before delivery was confirmed", updatedAt: now })
      .where(and(eq(agentSteeringInputs.runId, input.runId), eq(agentSteeringInputs.state, "dispatching")));
    await tx.delete(conversationRunLeases).where(eq(conversationRunLeases.runId, input.runId));
  });
}

export async function finalizeAgentRunJournal(input: {
  runId: string;
  parts: unknown[];
  aborted: boolean;
  message: {
    id: string;
    content: PersistedMessageContent;
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
    const [binding] = await tx
      .select({ conversationId: agentRuns.conversationId })
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId));
    if (!binding) throw new Error(`agent run ${input.runId} has no journal binding`);
    // Claim and finalization must acquire shared rows in the same order.
    // Otherwise an expired lease claim can deadlock with its old finalizer.
    const [conversation] = await tx
      .select({ historyRevision: conversations.historyRevision })
      .from(conversations)
      .where(eq(conversations.id, binding.conversationId))
      .for("update");
    const [run] = await tx.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).for("update");
    if (!run || !run.operation || !run.historyMessageId || run.historyRevision == null) {
      throw new Error(`agent run ${input.runId} has no journal binding`);
    }
    const historyRevision = Number(run.historyRevision);
    if (["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
      return { outputMessageId: run.outputMessageId, historyRevision, status: run.status as AgentRunStatus };
    }

    if (!conversation || conversation.historyRevision !== run.historyRevision) {
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
    const toolCalls = await tx.select().from(agentToolCalls).where(eq(agentToolCalls.runId, input.runId));
    if (aborted) {
      for (const toolCall of toolCalls) {
        if (toolCall.status === "running") {
          await tx
            .update(agentToolCalls)
            .set({
              status: "failed",
              error: "已取消。",
              durationMs: Math.max(0, now.getTime() - toolCall.createdAt.getTime()),
              finishedAt: now,
            })
            .where(eq(agentToolCalls.id, toolCall.id));
        } else if (toolCall.toolName === "update_todos" && toolCall.status === "completed") {
          await tx
            .update(agentToolCalls)
            .set({ outputJson: cancelTodoOutput(toolCall.outputJson) })
            .where(eq(agentToolCalls.id, toolCall.id));
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
          .update(agentToolCalls)
          .set({
            status: terminal.status,
            outputJson: terminal.output === undefined ? undefined : asJsonValue(terminal.output),
            error: terminal.status === "failed" ? errorText(terminal.error).slice(0, 4000) : null,
            durationMs: Math.max(0, now.getTime() - toolCall.createdAt.getTime()),
            finishedAt: now,
          })
          .where(eq(agentToolCalls.id, toolCall.id));
      }
    }

    let outputMessageId: string | null = null;
    if (message) {
      if (run.operation === "tool-continuation") {
        if (message.id !== run.targetMessageId) {
          throw new Error("continuation output message id does not match its target");
        }
        const updated = await tx
          .update(messages)
          .set({ content: message.content, status: message.status })
          .where(and(eq(messages.id, message.id), eq(messages.conversationId, run.conversationId)))
          .returning({ id: messages.id });
        if (!updated[0]) throw new Error(`continuation message ${message.id} is missing`);
        outputMessageId = message.id;
      } else {
        const siblings = await tx
          .select({ branchIndex: messages.branchIndex })
          .from(messages)
          .where(
            and(eq(messages.conversationId, run.conversationId), eq(messages.parentMessageId, run.historyMessageId)),
          );
        const branchIndex = siblings.reduce((maximum, row) => Math.max(maximum, row.branchIndex + 1), 0);
        await tx.insert(messages).values({
          id: message.id,
          conversationId: run.conversationId,
          role: "assistant",
          content: message.content,
          status: message.status,
          parentMessageId: run.historyMessageId,
          branchIndex,
          createdAt: new Date(),
        });
        outputMessageId = message.id;
      }
    }

    // Trace gaps must not rewrite the authoritative SDK outcome.
    await tx
      .update(agentSteps)
      .set({
        status: "failed",
        summary:
          status === "completed"
            ? "run completed without a recorded trace step completion"
            : error == null
              ? `run ${status}`
              : errorText(error).slice(0, 4000),
        finishedAt: now,
      })
      .where(and(eq(agentSteps.runId, input.runId), eq(agentSteps.status, "running")));
    await tx
      .update(agentRuns)
      .set({
        status,
        error: error == null ? null : errorText(error).slice(0, 4000),
        outputMessageId,
        inputTokens: input.inputTokens ?? undefined,
        outputTokens: input.outputTokens ?? undefined,
        cachedInputTokens: input.cachedInputTokens ?? undefined,
        reasoningTokens: input.reasoningTokens ?? undefined,
        totalTokens: input.totalTokens ?? undefined,
        finishedAt: now,
      })
      .where(eq(agentRuns.id, input.runId));
    await tx
      .update(conversations)
      .set({ ...(outputMessageId ? { selectedMessageId: outputMessageId } : {}), updatedAt: now })
      .where(eq(conversations.id, run.conversationId));
    await tx.delete(conversationRunLeases).where(eq(conversationRunLeases.runId, input.runId));
    return { outputMessageId, historyRevision, status };
  });
}

export async function requestAgentRunCancellation(runId: string): Promise<void> {
  await getDb()
    .update(agentRuns)
    .set({ status: "cancel_requested" })
    .where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, ["running", "cancel_requested"])));
}

export async function isRunActive(runId: string): Promise<boolean> {
  const run = await getAgentRunById(runId);
  return run?.status === "running" || run?.status === "cancel_requested";
}

export async function listOrphanedRuns(now = new Date()): Promise<Array<{ id: string; conversationId: string }>> {
  return getDb()
    .select({ id: agentRuns.id, conversationId: agentRuns.conversationId })
    .from(agentRuns)
    .leftJoin(conversationRunLeases, eq(conversationRunLeases.runId, agentRuns.id))
    .where(
      and(
        inArray(agentRuns.status, ["running", "cancel_requested"]),
        or(isNull(conversationRunLeases.runId), lte(conversationRunLeases.expiresAt, now)),
      ),
    );
}

export async function interruptRuns(runIds: string[]): Promise<Array<{ id: string; conversationId: string }>> {
  if (runIds.length === 0) {
    return [];
  }
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const interrupted = await tx
      .update(agentRuns)
      .set({ status: "interrupted", finishedAt: now })
      .where(
        and(
          inArray(agentRuns.id, runIds),
          inArray(agentRuns.status, ["running", "cancel_requested"]),
          notExists(
            tx
              .select({ runId: conversationRunLeases.runId })
              .from(conversationRunLeases)
              .where(and(eq(conversationRunLeases.runId, agentRuns.id), gt(conversationRunLeases.expiresAt, now))),
          ),
        ),
      )
      .returning({ id: agentRuns.id, conversationId: agentRuns.conversationId });
    const interruptedIds = interrupted.map((run) => run.id);
    if (interruptedIds.length === 0) return interrupted;
    await tx
      .update(agentSteeringInputs)
      .set({ state: "not_delivered", reason: "finished", updatedAt: now })
      .where(and(inArray(agentSteeringInputs.runId, interruptedIds), eq(agentSteeringInputs.state, "accepted")));
    await tx
      .update(agentSteeringInputs)
      .set({ state: "unconfirmed", reason: "run ownership was lost before delivery was confirmed", updatedAt: now })
      .where(and(inArray(agentSteeringInputs.runId, interruptedIds), eq(agentSteeringInputs.state, "dispatching")));
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
  contextSnapshot: ConversationContextSnapshot | null;
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

export interface LatestConversationContextRecord {
  runId: string;
  stepId: string;
  providerId: string;
  model: string;
  cachedInputTokens: number | null;
  totalEstimated: boolean;
  updatedAt: string;
  snapshot: ConversationContextSnapshot;
}

export async function getLatestResponseLineage(input: {
  runId: string;
  conversationId: string;
  providerId: string;
  model: string;
}): Promise<{ responseId: string; outputMessageId: string; inputTokens: number | null } | null> {
  const [latestRun] = await getDb()
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      outputMessageId: agentRuns.outputMessageId,
      providerId: agentRuns.providerId,
      model: agentRuns.model,
    })
    .from(agentRuns)
    .where(and(ne(agentRuns.id, input.runId), eq(agentRuns.conversationId, input.conversationId)))
    .orderBy(desc(agentRuns.createdAt))
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
      .select({ metadata: agentSteps.metadata, inputTokens: agentSteps.inputTokens, status: agentSteps.status })
      .from(agentSteps)
      .where(and(eq(agentSteps.runId, latestRun.id), eq(agentSteps.kind, "model")))
      .orderBy(desc(agentSteps.stepIndex))
      .limit(1),
    getDb()
      .select({ content: messages.content })
      .from(messages)
      .where(eq(messages.id, latestRun.outputMessageId))
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
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) {
    return null;
  }
  const steps = await db
    .select()
    .from(agentSteps)
    .where(eq(agentSteps.runId, runId))
    .orderBy(asc(agentSteps.stepIndex));
  const toolCalls = await db
    .select()
    .from(agentToolCalls)
    .where(eq(agentToolCalls.runId, runId))
    .orderBy(asc(agentToolCalls.createdAt));
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
      finishedAt: isoOrNull(s.finishedAt),
      inputTokens: s.inputTokens ?? null,
      outputTokens: s.outputTokens ?? null,
      totalTokens: s.totalTokens ?? null,
      contextSnapshot: parseConversationContextSnapshot(s.metadata?.context_snapshot),
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

export async function getLatestConversationContextRecord(
  conversationId: string,
): Promise<LatestConversationContextRecord | null> {
  const [row] = await getDb()
    .select({
      runId: agentRuns.id,
      stepId: agentSteps.id,
      providerId: agentRuns.providerId,
      model: agentRuns.model,
      metadata: agentSteps.metadata,
      inputTokens: agentSteps.inputTokens,
      runCreatedAt: agentRuns.createdAt,
      finishedAt: agentSteps.finishedAt,
    })
    .from(agentSteps)
    .innerJoin(agentRuns, eq(agentRuns.id, agentSteps.runId))
    .where(
      and(
        eq(agentRuns.conversationId, conversationId),
        eq(agentSteps.kind, "model"),
        inArray(agentSteps.status, ["completed", "failed"]),
        sql`${agentSteps.metadata}->'context_snapshot' IS NOT NULL`,
      ),
    )
    .orderBy(
      desc(agentRuns.createdAt),
      desc(sql<number>`CASE WHEN ${agentSteps.inputTokens} > 0 THEN 1 ELSE 0 END`),
      desc(agentSteps.stepIndex),
    )
    .limit(1);
  if (!row) {
    return null;
  }
  const snapshot = parseConversationContextSnapshot(row.metadata?.context_snapshot);
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

export async function recordAgentStepContextSnapshot(
  stepId: string,
  snapshot: ConversationContextSnapshot,
): Promise<void> {
  await getDb()
    .update(agentSteps)
    .set({
      metadata: sql`COALESCE(${agentSteps.metadata}, '{}'::jsonb) || jsonb_build_object('context_snapshot', ${JSON.stringify(snapshot)}::jsonb)`,
    })
    .where(eq(agentSteps.id, stepId));
}

export async function startAgentStep(input: {
  runId: string;
  stepIndex: number;
  kind: string;
  summary?: string;
  metadata?: Record<string, unknown> | null;
  stepId?: string;
}): Promise<string> {
  const stepId = input.stepId ?? id(16);
  await getDb()
    .insert(agentSteps)
    .values({
      id: stepId,
      runId: input.runId,
      stepIndex: input.stepIndex,
      kind: input.kind,
      status: "running",
      summary: input.summary ?? null,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: agentSteps.id,
      set: {
        status: "running",
        summary: input.summary ?? null,
        metadata: input.metadata ?? null,
        finishedAt: null,
      },
    });
  return stepId;
}

export async function finishAgentStep(input: {
  stepId: string;
  status: AgentStepStatus;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}): Promise<void> {
  await getDb()
    .update(agentSteps)
    .set({
      status: input.status,
      summary: input.summary ?? undefined,
      metadata: input.metadata ?? undefined,
      inputTokens: input.inputTokens ?? undefined,
      outputTokens: input.outputTokens ?? undefined,
      totalTokens: input.totalTokens ?? undefined,
      finishedAt: new Date(),
    })
    .where(eq(agentSteps.id, input.stepId));
}

export async function recordToolCallStart(input: {
  runId: string;
  toolCallId: string;
  stepIndex?: number | null;
  toolName: string;
  toolInput: unknown;
}): Promise<void> {
  await getDb()
    .insert(agentToolCalls)
    .values({
      id: input.toolCallId,
      runId: input.runId,
      stepIndex: input.stepIndex ?? null,
      toolName: input.toolName,
      status: "running",
      inputJson: asJsonValue(input.toolInput),
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: agentToolCalls.id,
      set: {
        runId: input.runId,
        stepIndex: input.stepIndex ?? null,
        toolName: input.toolName,
        status: "running",
        inputJson: asJsonValue(input.toolInput),
        error: null,
        finishedAt: null,
        durationMs: null,
        outputJson: sql`NULL`,
      },
    });
}

export async function recordToolCallFinish(input: {
  toolCallId: string;
  status: "completed" | "failed";
  output?: unknown;
  error?: unknown;
  durationMs?: number | null;
}): Promise<void> {
  await getDb()
    .update(agentToolCalls)
    .set({
      status: input.status,
      outputJson: input.output === undefined ? undefined : asJsonValue(input.output),
      error: input.error == null ? null : errorText(input.error).slice(0, 4000),
      durationMs: input.durationMs ?? null,
      finishedAt: new Date(),
    })
    .where(eq(agentToolCalls.id, input.toolCallId));
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
