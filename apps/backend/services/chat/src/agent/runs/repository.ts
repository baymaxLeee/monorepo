import { randomBytes } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { agentRuns, agentSteps, agentToolCalls } from "../../db/schema.js";
import { cancelTodoOutput } from "./cancellation.js";

export type AgentRunStatus = "running" | "cancel_requested" | "completed" | "failed" | "cancelled" | "interrupted";
export type AgentStepStatus = "running" | "completed" | "failed";

function id(bytes = 8): string {
  return randomBytes(bytes).toString("hex");
}

function asJsonValue(value: unknown): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  await getDb().insert(agentRuns).values({
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

export async function getAgentRunById(runId: string): Promise<
  | {
      id: string;
      conversationId: string;
      userId: string;
      status: AgentRunStatus;
    }
  | null
> {
  const [row] = await getDb()
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    userId: row.userId,
    status: row.status as AgentRunStatus,
  };
}

export async function finishAgentRun(input: {
  runId: string;
  status: AgentRunStatus;
  error?: unknown;
  outputMessageId?: string | null;
  totalTokens?: number | null;
}): Promise<void> {
  await getDb()
    .update(agentRuns)
    .set({
      status: input.status,
      error: input.error == null ? null : errorText(input.error).slice(0, 4000),
      outputMessageId: input.outputMessageId ?? undefined,
      totalTokens: input.totalTokens ?? undefined,
      finishedAt: new Date(),
    })
    .where(eq(agentRuns.id, input.runId));
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

export async function listOrphanedRuns(): Promise<Array<{ id: string; conversationId: string }>> {
  return getDb()
    .select({ id: agentRuns.id, conversationId: agentRuns.conversationId })
    .from(agentRuns)
    .where(inArray(agentRuns.status, ["running", "cancel_requested"]));
}

export async function interruptRuns(runIds: string[]): Promise<void> {
  if (runIds.length === 0) return;
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
  totalTokens: number | null;
  steps: AgentTraceStep[];
  toolCalls: AgentTraceToolCall[];
}

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString().replace("+00:00", "Z") : null;
}

export async function getRunTrace(runId: string): Promise<AgentRunTrace | null> {
  const db = getDb();
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) return null;
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
    totalTokens: run.totalTokens ?? null,
    steps: steps.map((s) => ({
      id: s.id,
      stepIndex: s.stepIndex,
      kind: s.kind,
      status: s.status as AgentStepStatus,
      summary: s.summary,
      createdAt: isoOrNull(s.createdAt) ?? "",
      finishedAt: isoOrNull(s.finishedAt),
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

export async function startAgentStep(input: {
  runId: string;
  stepIndex: number;
  kind: string;
  summary?: string;
  metadata?: Record<string, unknown> | null;
  stepId?: string;
}): Promise<string> {
  const stepId = input.stepId ?? id(16);
  await getDb().insert(agentSteps).values({
    id: stepId,
    runId: input.runId,
    stepIndex: input.stepIndex,
    kind: input.kind,
    status: "running",
    summary: input.summary ?? null,
    metadata: input.metadata ?? null,
    createdAt: new Date(),
  }).onDuplicateKeyUpdate({
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
    .onDuplicateKeyUpdate({
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

export interface PersistedToolCall {
  id: string;
  status: "running" | "completed" | "failed";
  output: unknown;
  error: string | null;
}

export async function listRunToolCalls(runId: string): Promise<PersistedToolCall[]> {
  const rows = await getDb()
    .select({
      id: agentToolCalls.id,
      status: agentToolCalls.status,
      output: agentToolCalls.outputJson,
      error: agentToolCalls.error,
    })
    .from(agentToolCalls)
    .where(eq(agentToolCalls.runId, runId))
    .orderBy(asc(agentToolCalls.createdAt));
  return rows.map((row) => ({
    id: row.id,
    status: row.status as PersistedToolCall["status"],
    output: row.output,
    error: row.error,
  }));
}

export async function finalizeCancelledRunToolCalls(runId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(agentToolCalls)
    .where(eq(agentToolCalls.runId, runId));
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

export async function latestCompletedToolOutput(
  conversationId: string,
  toolName: string,
): Promise<unknown | null> {
  const [row] = await getDb()
    .select({ output: agentToolCalls.outputJson })
    .from(agentToolCalls)
    .innerJoin(agentRuns, eq(agentRuns.id, agentToolCalls.runId))
    .where(and(
      eq(agentRuns.conversationId, conversationId),
      eq(agentToolCalls.toolName, toolName),
      eq(agentToolCalls.status, "completed"),
    ))
    .orderBy(sql`${agentToolCalls.finishedAt} DESC`)
    .limit(1);
  return row?.output ?? null;
}
