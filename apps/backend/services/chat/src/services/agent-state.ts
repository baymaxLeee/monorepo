import { createHash, randomBytes } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { agentRuns, agentSteps, agentToolCalls, userMemories } from "../db/schema.js";

export type AgentRunStatus = "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export type AgentStepStatus = "running" | "completed" | "failed";
export type MemoryCategory = "preference" | "profile" | "project" | "instruction";

function id(bytes = 8): string {
  return randomBytes(bytes).toString("hex");
}

export function deterministicId(...parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join(":"))
    .digest("hex")
    .slice(0, 32);
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
  workflowName?: string | null;
  workflowVersion?: string | null;
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
    workflowName: input.workflowName ?? null,
    workflowVersion: input.workflowVersion ?? null,
    createdAt: now,
    startedAt: now,
  });
  return runId;
}

export async function bindWorkflowRun(input: {
  runId: string;
  workflowRunId: string;
  workflowName: string;
  workflowVersion: string;
}): Promise<void> {
  await getDb()
    .update(agentRuns)
    .set({
      workflowRunId: input.workflowRunId,
      workflowName: input.workflowName,
      workflowVersion: input.workflowVersion,
    })
    .where(eq(agentRuns.id, input.runId));
}

export async function getAgentRunByWorkflowRunId(workflowRunId: string): Promise<
  | {
      id: string;
      conversationId: string;
      userId: string;
      status: AgentRunStatus;
      workflowName: string | null;
      workflowVersion: string | null;
    }
  | null
> {
  const [row] = await getDb()
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.workflowRunId, workflowRunId));
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    userId: row.userId,
    status: row.status as AgentRunStatus,
    workflowName: row.workflowName,
    workflowVersion: row.workflowVersion,
  };
}

export async function finishAgentRun(input: {
  runId: string;
  status: AgentRunStatus;
  error?: unknown;
  outputMessageId?: string | null;
  totalTokens?: number | null;
}): Promise<void> {
  "use step";
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
  "use step";
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
}): Promise<void> {
  "use step";
  await getDb()
    .update(agentSteps)
    .set({
      status: input.status,
      summary: input.summary ?? undefined,
      metadata: input.metadata ?? undefined,
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
  "use step";
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
  "use step";
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
  "use step";
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

export async function latestCompletedToolOutput(
  conversationId: string,
  toolName: string,
): Promise<unknown | null> {
  "use step";
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

export type MemoryStatus = "pending" | "active" | "rejected" | "superseded";

export interface UserMemory {
  id: string;
  category: MemoryCategory;
  content: string;
  confidence: number;
}

export interface MemoryCandidate {
  id: string;
  category: MemoryCategory;
  content: string;
  reason: string | null;
  supersedesId: string | null;
  createdAt: string;
}

function isoOrEmpty(d: Date | null): string {
  return d ? d.toISOString().replace("+00:00", "Z") : "";
}

export async function listActiveMemories(userId: string): Promise<UserMemory[]> {
  const rows = await getDb()
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active")))
    .orderBy(asc(userMemories.createdAt));
  return rows.map((row) => ({
    id: row.id,
    category: row.category as MemoryCategory,
    content: row.content,
    confidence: row.confidence,
  }));
}

export async function listPendingCandidates(userId: string): Promise<MemoryCandidate[]> {
  const rows = await getDb()
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "pending")))
    .orderBy(asc(userMemories.createdAt));
  return rows.map((row) => ({
    id: row.id,
    category: row.category as MemoryCategory,
    content: row.content,
    reason: row.reason,
    supersedesId: row.supersedesId,
    createdAt: isoOrEmpty(row.createdAt),
  }));
}

export async function listMemoryDedupEntries(
  userId: string,
): Promise<Array<{ category: MemoryCategory; content: string; status: MemoryStatus }>> {
  const rows = await getDb()
    .select({
      category: userMemories.category,
      content: userMemories.content,
      status: userMemories.status,
    })
    .from(userMemories)
    .where(
      and(
        eq(userMemories.userId, userId),
        inArray(userMemories.status, ["active", "pending", "rejected"]),
      ),
    );
  return rows.map((row) => ({
    category: row.category as MemoryCategory,
    content: row.content,
    status: row.status as MemoryStatus,
  }));
}

export async function createMemoryCandidate(input: {
  userId: string;
  category: MemoryCategory;
  content: string;
  reason?: string | null;
  originRunId?: string | null;
  supersedesId?: string | null;
  source?: string;
}): Promise<MemoryCandidate & { status: MemoryStatus }> {
  "use step";
  const content = input.content.trim().replace(/\s+/g, " ");
  const [existing] = await getDb()
    .select()
    .from(userMemories)
    .where(
      and(
        eq(userMemories.userId, input.userId),
        eq(userMemories.category, input.category),
        eq(userMemories.content, content),
        inArray(userMemories.status, ["active", "pending", "rejected"]),
      ),
    );
  if (existing) {
    return {
      id: existing.id,
      category: existing.category as MemoryCategory,
      content: existing.content,
      reason: existing.reason,
      supersedesId: existing.supersedesId,
      createdAt: isoOrEmpty(existing.createdAt),
      status: existing.status as MemoryStatus,
    };
  }
  const now = new Date();
  const row = {
    id: deterministicId("memory-candidate", input.userId, input.category, content.toLowerCase()),
    userId: input.userId,
    category: input.category,
    content,
    source: input.source ?? "agent-extracted",
    confidence: 80,
    status: "pending",
    reason: input.reason ?? null,
    originRunId: input.originRunId ?? null,
    supersedesId: input.supersedesId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await getDb()
    .insert(userMemories)
    .values(row)
    .onDuplicateKeyUpdate({
      // A retry or repeated proposal must not demote an active/rejected row
      // back to pending. The deterministic primary key makes this a no-op.
      set: { id: row.id },
    });
  const [stored] = await getDb()
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.id, row.id), eq(userMemories.userId, input.userId)));
  if (!stored) throw new Error("memory candidate insert did not persist");
  return {
    id: stored.id,
    category: stored.category as MemoryCategory,
    content: stored.content,
    reason: stored.reason,
    supersedesId: stored.supersedesId,
    createdAt: isoOrEmpty(stored.createdAt),
    status: stored.status as MemoryStatus,
  };
}

async function getOwnedMemory(userId: string, memoryId: string) {
  const [row] = await getDb()
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.id, memoryId), eq(userMemories.userId, userId)));
  return row ?? null;
}

export async function approveCandidate(userId: string, candidateId: string): Promise<UserMemory | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(userMemories)
      .where(
        and(
          eq(userMemories.id, candidateId),
          eq(userMemories.userId, userId),
          eq(userMemories.status, "pending"),
        ),
      )
      .for("update");
    if (!candidate) return null;

    const now = new Date();
    if (candidate.supersedesId) {
      await tx
        .update(userMemories)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(userMemories.id, candidate.supersedesId),
            eq(userMemories.userId, userId),
            eq(userMemories.status, "active"),
          ),
        );
    }
    await tx
      .update(userMemories)
      .set({ status: "active", source: "user-approved", confidence: 100, updatedAt: now })
      .where(
        and(
          eq(userMemories.id, candidateId),
          eq(userMemories.userId, userId),
          eq(userMemories.status, "pending"),
        ),
      );
    return {
      id: candidate.id,
      category: candidate.category as MemoryCategory,
      content: candidate.content,
      confidence: 100,
    };
  });
}

export async function rejectCandidate(userId: string, candidateId: string): Promise<boolean> {
  const candidate = await getOwnedMemory(userId, candidateId);
  if (!candidate || candidate.status !== "pending") return false;
  await getDb()
    .update(userMemories)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(userMemories.id, candidateId));
  return true;
}

export async function updateCandidate(
  userId: string,
  candidateId: string,
  patch: { category?: MemoryCategory; content?: string },
): Promise<MemoryCandidate | null> {
  const candidate = await getOwnedMemory(userId, candidateId);
  if (!candidate || candidate.status !== "pending") return null;
  const content = patch.content?.trim().replace(/\s+/g, " ");
  await getDb()
    .update(userMemories)
    .set({
      category: patch.category ?? undefined,
      content: content ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(userMemories.id, candidateId));
  return {
    id: candidate.id,
    category: (patch.category ?? candidate.category) as MemoryCategory,
    content: content ?? candidate.content,
    reason: candidate.reason,
    supersedesId: candidate.supersedesId,
    createdAt: isoOrEmpty(candidate.createdAt),
  };
}

export async function deleteMemory(userId: string, memoryId: string): Promise<boolean> {
  const memory = await getOwnedMemory(userId, memoryId);
  if (!memory) return false;
  await getDb()
    .delete(userMemories)
    .where(and(eq(userMemories.id, memoryId), eq(userMemories.userId, userId)));
  return true;
}
