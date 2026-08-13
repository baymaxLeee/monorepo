import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import { getDb } from "../../../infrastructure/persistence/index.js";
import {
  agentRuns,
  agentSteps,
  agentToolCalls,
  conversationRunLeases,
} from "../../../infrastructure/persistence/schema.js";
import { parseConversationContextSnapshot, type ConversationContextSnapshot } from "../context/context-snapshot.js";
import { isToolOutcome } from "../tools/outcome.js";
import { cancelTodoOutput } from "./cancellation.js";

export type AgentRunStatus = "running" | "cancel_requested" | "completed" | "failed" | "cancelled" | "interrupted";
export type AgentStepStatus = "running" | "completed" | "failed";

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

export async function getAgentRunById(runId: string): Promise<{
  id: string;
  conversationId: string;
  userId: string;
  providerId: string;
  status: AgentRunStatus;
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
    const [unfinishedStep] = await tx
      .select({ id: agentSteps.id })
      .from(agentSteps)
      .where(and(eq(agentSteps.runId, input.runId), eq(agentSteps.status, "running")))
      .limit(1);
    const incompleteCompletion = input.status === "completed" && unfinishedStep != null;
    const status = incompleteCompletion ? "failed" : input.status;
    const error = incompleteCompletion ? (input.error ?? "run ended before its model step completed") : input.error;
    const now = new Date();

    if (status !== "completed") {
      await tx
        .update(agentSteps)
        .set({
          status: "failed",
          summary: error == null ? `run ${status}` : errorText(error).slice(0, 4000),
          finishedAt: now,
        })
        .where(and(eq(agentSteps.runId, input.runId), eq(agentSteps.status, "running")));
    }

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

export async function interruptRuns(runIds: string[]): Promise<void> {
  if (runIds.length === 0) {
    return;
  }
  await getDb()
    .update(agentRuns)
    .set({ status: "interrupted", finishedAt: new Date() })
    .where(inArray(agentRuns.id, runIds));
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
}): Promise<{ responseId: string; outputMessageId: string } | null> {
  const [latestRun] = await getDb()
    .select({ id: agentRuns.id, status: agentRuns.status, outputMessageId: agentRuns.outputMessageId })
    .from(agentRuns)
    .where(
      and(
        ne(agentRuns.id, input.runId),
        eq(agentRuns.conversationId, input.conversationId),
        eq(agentRuns.providerId, input.providerId),
        eq(agentRuns.model, input.model),
      ),
    )
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  if (latestRun?.status !== "completed" || !latestRun.outputMessageId) {
    return null;
  }
  const [row] = await getDb()
    .select({ metadata: agentSteps.metadata })
    .from(agentSteps)
    .where(
      and(
        eq(agentSteps.runId, latestRun.id),
        eq(agentSteps.kind, "model"),
        eq(agentSteps.status, "completed"),
        sql`${agentSteps.metadata}->>'response_id' IS NOT NULL`,
      ),
    )
    .orderBy(desc(agentSteps.stepIndex))
    .limit(1);
  const responseId = row?.metadata?.response_id;
  if (typeof responseId !== "string") {
    return null;
  }
  return { responseId, outputMessageId: latestRun.outputMessageId };
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

export async function finalizeRunToolCallsFromParts(runId: string, parts: unknown[]): Promise<void> {
  const terminalById = new Map<string, ReturnType<typeof terminalToolPart>>();
  for (const part of parts) {
    const terminal = terminalToolPart(part);
    if (terminal) {
      terminalById.set(terminal.toolCallId, terminal);
    }
  }
  if (terminalById.size === 0) {
    return;
  }

  const db = getDb();
  const rows = await db
    .select({ id: agentToolCalls.id, createdAt: agentToolCalls.createdAt })
    .from(agentToolCalls)
    .where(and(eq(agentToolCalls.runId, runId), eq(agentToolCalls.status, "running")));
  const now = new Date();
  await Promise.all(
    rows.map((row) => {
      const terminal = terminalById.get(row.id);
      if (!terminal) {
        return Promise.resolve();
      }
      return db
        .update(agentToolCalls)
        .set({
          status: terminal.status,
          outputJson: terminal.output === undefined ? undefined : asJsonValue(terminal.output),
          error: terminal.status === "failed" ? errorText(terminal.error).slice(0, 4000) : null,
          durationMs: Math.max(0, now.getTime() - row.createdAt.getTime()),
          finishedAt: now,
        })
        .where(eq(agentToolCalls.id, row.id));
    }),
  );
}

export async function finalizeCancelledRunToolCalls(runId: string): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(agentToolCalls).where(eq(agentToolCalls.runId, runId));
  const now = new Date();
  await Promise.all(
    rows.map((row) => {
      if (row.status === "running") {
        return db
          .update(agentToolCalls)
          .set({ status: "failed", error: "已取消。", finishedAt: now })
          .where(eq(agentToolCalls.id, row.id));
      }
      if (row.toolName === "update_todos" && row.status === "completed") {
        return db
          .update(agentToolCalls)
          .set({ outputJson: cancelTodoOutput(row.outputJson) })
          .where(eq(agentToolCalls.id, row.id));
      }
      return Promise.resolve();
    }),
  );
}
