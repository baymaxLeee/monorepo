import { randomBytes } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { agentRuns, agentSteps, agentToolCalls, userMemories } from "../db/schema.js";

export type AgentRunStatus = "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export type AgentStepStatus = "running" | "completed" | "failed";
export type MemoryCategory = "preference" | "profile" | "project" | "instruction";

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
      outputMessageId: input.outputMessageId ?? null,
      totalTokens: input.totalTokens ?? null,
      finishedAt: new Date(),
    })
    .where(eq(agentRuns.id, input.runId));
}

export async function startAgentStep(input: {
  runId: string;
  stepIndex: number;
  kind: string;
  summary?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<string> {
  const stepId = id(16);
  await getDb().insert(agentSteps).values({
    id: stepId,
    runId: input.runId,
    stepIndex: input.stepIndex,
    kind: input.kind,
    status: "running",
    summary: input.summary ?? null,
    metadata: input.metadata ?? null,
    createdAt: new Date(),
  });
  return stepId;
}

export async function finishAgentStep(input: {
  stepId: string;
  status: AgentStepStatus;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
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

export interface UserMemory {
  id: string;
  category: MemoryCategory;
  content: string;
  confidence: number;
}

export async function listActiveMemories(userId: string, limit: number): Promise<UserMemory[]> {
  const rows = await getDb()
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active")))
    .orderBy(asc(userMemories.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    category: row.category as MemoryCategory,
    content: row.content,
    confidence: row.confidence,
  }));
}

export async function saveUserMemory(input: {
  userId: string;
  category: MemoryCategory;
  content: string;
  source?: string;
  confidence?: number;
}): Promise<UserMemory> {
  const now = new Date();
  const memory = {
    id: id(16),
    userId: input.userId,
    category: input.category,
    content: input.content.trim(),
    source: input.source ?? "agent",
    confidence: input.confidence ?? 80,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await getDb().insert(userMemories).values(memory);
  return {
    id: memory.id,
    category: memory.category,
    content: memory.content,
    confidence: memory.confidence,
  };
}
