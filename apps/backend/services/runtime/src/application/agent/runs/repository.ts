import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  classifyTurnRecovery,
  normalizePersistedTurnPluginSnapshot,
  type TurnRecoveryDecision,
  toPersistedTurnPluginSnapshot,
  type PersistedTurnPluginSnapshot,
  type ResolvedTurnPluginSnapshot,
  isToolOutcome,
} from "@repo/agent-runtime";
import type { UIMessage } from "ai";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, notExists, or, sql } from "drizzle-orm";

import { getDb } from "../../../infrastructure/persistence/index.js";
import {
  contextCheckpoints,
  threadItems,
  threads,
  toolEffects,
  turnAttempts,
  turnInputs,
  turnLeases,
  turnPluginSnapshots,
  turnResumeEnvelopes,
  threadTurns,
  turnSteps,
} from "../../../infrastructure/persistence/schema.js";
import type {
  PersistedThreadItemContent,
  PersistedTurnResumeSnapshot,
} from "../../../infrastructure/persistence/schema.js";
import { ConflictError, RequestError } from "../../errors.js";
import { parseSessionContextSnapshot, type SessionContextSnapshot } from "../context/context-snapshot.js";
import {
  cancelPlanOutput,
  finalizeCancelledParts,
  finalizeTerminalParts,
  terminalRunErrorText,
  type TerminalRunStatus,
} from "./cancellation.js";
import { mergeClientContinuation } from "./continuation.js";

export type AgentRunStatus =
  | "running"
  | "cancel_requested"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type AgentStepStatus = "running" | "completed" | "failed";
export const RUN_LEASE_MS = 10 * 60_000;
export type AgentRunOperation = "submit-message" | "edit-message" | "regenerate-message" | "tool-continuation";
type AgentAttemptOperation = AgentRunOperation | "internal" | "recovery";

export type ClaimedAgentRun = {
  runId: string;
  attemptEpoch: bigint;
  historyRevision: number;
  historyMessageId: string;
  inputMessageId: string | null;
} & ({ duplicate: false } | { duplicate: true; streaming: boolean });

export interface RunLeaseToken {
  runId: string;
  attemptEpoch: bigint;
}

export interface TurnResumeEnvelope {
  runId: string;
  attemptEpoch: bigint;
  sessionId: string;
  historyMessageId: string;
  historyRevision: number;
  historyDigest: string;
  instructionDigest: string;
  toolCatalogDigest: string;
  workspaceDigest: string;
  compactorVersion: string;
  remoteBinding: string | null;
  snapshot: PersistedTurnResumeSnapshot;
}

export type OrphanedTurnRecovery =
  | {
      state: "claimed";
      decision: "resume-next-step" | "regenerate-model";
      token: RunLeaseToken;
      envelope: TurnResumeEnvelope;
    }
  | { state: "stable"; decision: "resume-waiting" }
  | { state: "interrupted"; decision: "interrupt" | "reconcile-effect" };

export type RuntimeTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function requireOwnedRun(
  tx: RuntimeTransaction,
  token: RunLeaseToken,
  options: { allowTerminal?: boolean } = {},
): Promise<typeof threadTurns.$inferSelect> {
  const [run] = await tx.select().from(threadTurns).where(eq(threadTurns.id, token.runId));
  const [attempt] = await tx
    .select({ status: turnAttempts.status })
    .from(turnAttempts)
    .where(and(eq(turnAttempts.turnId, token.runId), eq(turnAttempts.attemptEpoch, token.attemptEpoch)));
  if (!run || !attempt) {
    throw new ConflictError("agent run ownership was lost", "run_lease_lost");
  }
  if (options.allowTerminal && ["waiting", "completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
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
  if (!lease || !["running", "cancel_requested"].includes(run.status) || attempt.status !== "running") {
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

function canonicalJson(value: unknown): unknown {
  const persisted = asJsonValue(value);
  if (Array.isArray(persisted)) return persisted.map(canonicalJson);
  if (persisted && typeof persisted === "object") {
    return Object.fromEntries(
      Object.entries(persisted as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return persisted;
}

function toolInputDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(value)))
    .digest("hex");
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
    await tx.insert(threadTurns).values({
      id: runId,
      threadId: input.sessionId,
      ordinal,
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
    return record?.snapshot ? normalizePersistedTurnPluginSnapshot(record.snapshot) : null;
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
    const current = normalizePersistedTurnPluginSnapshot(existing.snapshot);
    if (!isDeepStrictEqual(current, snapshot)) {
      throw new Error(`agent run ${token.runId} plugin snapshot is immutable`);
    }
    return current;
  });
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function turnResumeEnvelopeFromRow(row: typeof turnResumeEnvelopes.$inferSelect): TurnResumeEnvelope {
  return {
    runId: row.turnId,
    attemptEpoch: row.attemptEpoch,
    sessionId: row.threadId,
    historyMessageId: row.historyItemId,
    historyRevision: Number(row.historyRevision),
    historyDigest: row.historyDigest,
    instructionDigest: row.instructionDigest,
    toolCatalogDigest: row.toolCatalogDigest,
    workspaceDigest: row.workspaceDigest,
    compactorVersion: row.compactorVersion,
    remoteBinding: row.remoteBinding,
    snapshot: row.snapshot,
  };
}

/** Freeze the complete non-secret reconstruction boundary before host code can
 * produce a model request or tool effect. Rewriting any fact fails closed. */
export async function persistTurnResumeEnvelope(
  token: RunLeaseToken,
  input: Omit<TurnResumeEnvelope, "runId" | "attemptEpoch">,
): Promise<TurnResumeEnvelope> {
  for (const digest of [input.historyDigest, input.instructionDigest, input.toolCatalogDigest, input.workspaceDigest]) {
    if (!SHA256_PATTERN.test(digest)) throw new Error("turn resume envelope contains an invalid digest");
  }
  if (input.snapshot.schemaVersion !== 2) {
    throw new Error("turn resume envelope contains an invalid snapshot");
  }
  return getDb().transaction(async (tx) => {
    const run = await requireOwnedRun(tx, token);
    const [attempt] = await tx
      .select()
      .from(turnAttempts)
      .where(and(eq(turnAttempts.turnId, token.runId), eq(turnAttempts.attemptEpoch, token.attemptEpoch)));
    if (
      !attempt ||
      attempt.threadId !== input.sessionId ||
      attempt.historyItemId !== input.historyMessageId ||
      attempt.historyRevision !== BigInt(input.historyRevision) ||
      run.threadId !== input.sessionId
    ) {
      throw new ConflictError("turn resume envelope does not match its journal binding", "resume_envelope_conflict");
    }
    const now = new Date();
    const value = {
      turnId: token.runId,
      attemptEpoch: token.attemptEpoch,
      threadId: input.sessionId,
      historyItemId: input.historyMessageId,
      historyRevision: BigInt(input.historyRevision),
      historyDigest: input.historyDigest,
      instructionDigest: input.instructionDigest,
      toolCatalogDigest: input.toolCatalogDigest,
      workspaceDigest: input.workspaceDigest,
      compactorVersion: input.compactorVersion,
      remoteBinding: input.remoteBinding,
      snapshot: input.snapshot,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await tx
      .insert(turnResumeEnvelopes)
      .values(value)
      .onConflictDoNothing({ target: [turnResumeEnvelopes.turnId, turnResumeEnvelopes.attemptEpoch] })
      .returning();
    if (inserted[0]) return turnResumeEnvelopeFromRow(inserted[0]);
    const [existing] = await tx
      .select()
      .from(turnResumeEnvelopes)
      .where(
        and(eq(turnResumeEnvelopes.turnId, token.runId), eq(turnResumeEnvelopes.attemptEpoch, token.attemptEpoch)),
      );
    if (!existing) throw new Error(`turn ${token.runId} resume envelope could not be persisted`);
    const expected = { ...value, createdAt: existing.createdAt, updatedAt: existing.updatedAt };
    if (!isDeepStrictEqual(existing, expected)) {
      throw new ConflictError("turn resume envelope is immutable", "resume_envelope_conflict");
    }
    return turnResumeEnvelopeFromRow(existing);
  });
}

export async function claimAgentRunOperation(input: {
  sessionId: string;
  providerId: string;
  model: string;
  requestId: string;
  expectedRevision: number;
  operation: AgentRunOperation;
  targetMessageId?: string | null;
  continuationMessage?: UIMessage<unknown, any, any>;
  requestContext?: { reasoningEffort?: string; capabilitiesDigest?: string };
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
        .select({ run: threadTurns, attempt: turnAttempts })
        .from(turnAttempts)
        .innerJoin(threadTurns, eq(threadTurns.id, turnAttempts.turnId))
        .where(and(eq(turnAttempts.threadId, input.sessionId), eq(turnAttempts.requestId, input.requestId)))
        .limit(1);
      if (!existing) return null;
      if (
        existing.attempt.requestFingerprint !== requestFingerprint ||
        existing.attempt.operation !== input.operation ||
        (existing.attempt.targetItemId ?? null) !== (input.targetMessageId ?? null)
      ) {
        throw new ConflictError("request_id is already bound to a different chat operation", "request_id_conflict");
      }
      if (!existing.attempt.historyItemId || existing.attempt.historyRevision == null) {
        throw new Error(`agent run ${existing.run.id} attempt is missing its history binding`);
      }
      return {
        runId: existing.run.id,
        attemptEpoch: existing.attempt.attemptEpoch,
        duplicate: true,
        streaming: existing.run.status === "running" || existing.run.status === "cancel_requested",
        historyRevision: Number(existing.attempt.historyRevision),
        historyMessageId: existing.attempt.historyItemId,
        inputMessageId: existing.run.inputItemId,
      } satisfies ClaimedAgentRun;
    };

    const beforeLock = await findExisting();
    if (beforeLock) return beforeLock;

    const [session] = await tx.select().from(threads).where(eq(threads.id, input.sessionId)).for("update");
    if (!session) throw new RequestError("session does not exist");

    const afterLock = await findExisting();
    if (afterLock) return afterLock;
    const now = new Date();
    const [activeLease] = await tx
      .select()
      .from(turnLeases)
      .where(eq(turnLeases.threadId, input.sessionId))
      .for("update");
    if (activeLease && activeLease.expiresAt > now) {
      throw new ConflictError("this session already has an active run", "active_run_exists", {
        run_id: activeLease.turnId,
      });
    }
    if (activeLease) {
      await tx.delete(turnLeases).where(eq(turnLeases.turnId, activeLease.turnId));
      await tx
        .update(threadTurns)
        .set({ status: "interrupted", completedAt: now, error: "turn lease expired" })
        .where(
          and(eq(threadTurns.id, activeLease.turnId), inArray(threadTurns.status, ["running", "cancel_requested"])),
        );
      await tx
        .update(turnAttempts)
        .set({ status: "interrupted", completedAt: now, error: "turn lease expired" })
        .where(
          and(
            eq(turnAttempts.turnId, activeLease.turnId),
            eq(turnAttempts.attemptEpoch, activeLease.attemptEpoch),
            eq(turnAttempts.status, "running"),
          ),
        );
    }
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
    const [unfinishedTurn] = await tx
      .select({ id: threadTurns.id, status: threadTurns.status })
      .from(threadTurns)
      .where(
        and(
          eq(threadTurns.threadId, input.sessionId),
          inArray(threadTurns.status, ["running", "cancel_requested", "waiting"]),
        ),
      )
      .orderBy(desc(threadTurns.ordinal))
      .limit(1)
      .for("update");
    const resumesWaitingTurn =
      input.operation === "tool-continuation" &&
      unfinishedTurn?.status === "waiting" &&
      target?.turnId === unfinishedTurn.id;
    if (unfinishedTurn && !resumesWaitingTurn) {
      throw new ConflictError("this session already has an active run", "active_run_exists", {
        run_id: unfinishedTurn.id,
      });
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
    let runId: string;
    let attemptEpoch: bigint;
    let turnOrdinal = session.turnSequence;
    if (input.operation === "tool-continuation") {
      const [source] = target?.turnId
        ? await tx
            .select({ run: threadTurns, snapshot: turnPluginSnapshots.snapshot })
            .from(threadTurns)
            .innerJoin(turnPluginSnapshots, eq(threadTurns.id, turnPluginSnapshots.turnId))
            .where(and(eq(threadTurns.threadId, input.sessionId), eq(threadTurns.id, target.turnId)))
            .for("update", { of: threadTurns })
        : [];
      if (!source) {
        throw new ConflictError("tool continuation has no frozen plugin snapshot", "plugin_snapshot_missing");
      }
      if (source.run.status !== "waiting") {
        throw new ConflictError("tool continuation is not waiting for client input", "turn_not_waiting");
      }
      if (source.run.providerId !== input.providerId || source.run.model !== input.model) {
        throw new ConflictError("tool continuation cannot change the frozen model", "turn_snapshot_conflict");
      }
      const [previousAttempt] = await tx
        .select({ attemptEpoch: turnAttempts.attemptEpoch, status: turnAttempts.status })
        .from(turnAttempts)
        .where(eq(turnAttempts.turnId, source.run.id))
        .orderBy(desc(turnAttempts.attemptEpoch))
        .limit(1);
      if (!previousAttempt) throw new Error(`logical Turn ${source.run.id} has no physical attempt`);
      const [previousEnvelope] = await tx
        .select({ snapshot: turnResumeEnvelopes.snapshot })
        .from(turnResumeEnvelopes)
        .where(
          and(
            eq(turnResumeEnvelopes.turnId, source.run.id),
            eq(turnResumeEnvelopes.attemptEpoch, previousAttempt.attemptEpoch),
          ),
        );
      const frozen = previousEnvelope?.snapshot.execution;
      if (
        previousAttempt.status !== "waiting" ||
        !frozen ||
        frozen.assistantMessageId !== historyMessageId ||
        frozen.approvalPolicy !== session.approvalPolicy ||
        frozen.permissionProfile !== session.permissionProfile
      ) {
        throw new ConflictError(
          "tool continuation does not match the frozen Turn approval boundary",
          "turn_snapshot_conflict",
        );
      }
      runId = source.run.id;
      attemptEpoch = previousAttempt.attemptEpoch + 1n;
      await tx
        .update(threadTurns)
        .set({ status: "running", error: null, completedAt: null })
        .where(eq(threadTurns.id, runId));
    } else {
      runId = id(16);
      attemptEpoch = 1n;
      turnOrdinal += 1n;
      await tx.insert(threadTurns).values({
        id: runId,
        threadId: input.sessionId,
        ordinal: turnOrdinal,
        providerId: input.providerId,
        model: input.model,
        status: "running",
        inputItemId: inputMessageId,
        createdAt: now,
        startedAt: now,
      });
    }
    await tx.insert(turnAttempts).values({
      turnId: runId,
      attemptEpoch,
      threadId: input.sessionId,
      requestId: input.requestId,
      requestFingerprint,
      operation: input.operation,
      targetItemId: input.targetMessageId ?? null,
      historyItemId: historyMessageId,
      historyRevision: BigInt(historyRevision),
      status: "running",
      startedAt: now,
    });
    await tx.insert(turnLeases).values({
      threadId: input.sessionId,
      turnId: runId,
      attemptEpoch,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + RUN_LEASE_MS),
    });
    await tx
      .update(threads)
      .set({
        ...(input.operation === "tool-continuation" ? {} : { turnSequence: turnOrdinal }),
        itemSequence: inputMessageId ? session.itemSequence + 1n : session.itemSequence,
        historyRevision: BigInt(historyRevision),
        selectedItemId: selectedMessageId,
        updatedAt: now,
      })
      .where(eq(threads.id, input.sessionId));
    return { runId, attemptEpoch, duplicate: false, historyRevision, historyMessageId, inputMessageId };
  });
}

export async function getAgentRunById(runId: string): Promise<{
  id: string;
  sessionId: string;
  providerId: string;
  status: AgentRunStatus;
  requestId: string | null;
  operation: AgentRunOperation | null;
  targetMessageId: string | null;
  historyMessageId: string | null;
  historyRevision: number | null;
  outputMessageId: string | null;
} | null> {
  const [row] = await getDb().select().from(threadTurns).where(eq(threadTurns.id, runId));
  if (!row) {
    return null;
  }
  const [attempt] = await getDb()
    .select()
    .from(turnAttempts)
    .where(eq(turnAttempts.turnId, runId))
    .orderBy(desc(turnAttempts.attemptEpoch))
    .limit(1);
  const operation = attempt?.operation as AgentAttemptOperation | undefined;
  return {
    id: row.id,
    sessionId: row.threadId,
    providerId: row.providerId,
    status: row.status as AgentRunStatus,
    requestId: attempt?.requestId ?? null,
    operation:
      operation && operation !== "internal" && operation !== "recovery" ? (operation as AgentRunOperation) : null,
    targetMessageId: attempt?.targetItemId ?? null,
    historyMessageId: attempt?.historyItemId ?? null,
    historyRevision: attempt?.historyRevision == null ? null : Number(attempt.historyRevision),
    outputMessageId: row.outputItemId,
  };
}

function isTerminalFailureStatus(status: AgentRunStatus): status is TerminalRunStatus {
  return status === "failed" || status === "cancelled" || status === "interrupted";
}

async function finalizeTerminalToolEffects(
  tx: RuntimeTransaction,
  calls: Array<typeof toolEffects.$inferSelect>,
  input: {
    runId: string;
    status: TerminalRunStatus;
    now: Date;
    itemId: string | null;
  },
): Promise<void> {
  const reason = terminalRunErrorText(input.status);
  for (const call of calls) {
    if (call.status === "running") {
      await tx
        .update(toolEffects)
        .set({
          status: "failed",
          error: reason,
          durationMs: Math.max(0, input.now.getTime() - call.createdAt.getTime()),
          completedAt: input.now,
          itemId: input.itemId,
        })
        .where(and(eq(toolEffects.turnId, input.runId), eq(toolEffects.id, call.id)));
    } else if (input.status === "cancelled" && call.toolName === "update_plan" && call.status === "completed") {
      await tx
        .update(toolEffects)
        .set({ outputJson: cancelPlanOutput(call.outputJson), itemId: input.itemId })
        .where(and(eq(toolEffects.turnId, input.runId), eq(toolEffects.id, call.id)));
    }
  }
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
    const [binding] = await tx
      .select({ threadId: threadTurns.threadId })
      .from(threadTurns)
      .where(eq(threadTurns.id, input.runId));
    if (!binding) return;
    const [thread] = await tx.select().from(threads).where(eq(threads.id, binding.threadId)).for("update");
    const [run] = await tx.select().from(threadTurns).where(eq(threadTurns.id, input.runId)).for("update");
    if (!run) return;
    if (!["running", "cancel_requested"].includes(run.status)) {
      return;
    }
    await requireOwnedRun(tx, input);
    const { status, error } = input;
    const now = new Date();
    const terminalFailure = isTerminalFailureStatus(status);
    const outputItemId = input.outputMessageId ?? run.outputItemId;

    if (terminalFailure && outputItemId) {
      const [item] = await tx
        .select()
        .from(threadItems)
        .where(and(eq(threadItems.id, outputItemId), eq(threadItems.threadId, run.threadId)))
        .for("update");
      if (!item) throw new Error(`agent run ${input.runId} assistant item does not exist`);
      const metadata =
        item.content.metadata && typeof item.content.metadata === "object"
          ? { ...item.content.metadata, status: status === "cancelled" ? "cancelled" : "failed" }
          : item.content.metadata;
      await tx
        .update(threadItems)
        .set({
          content: {
            ...item.content,
            parts: finalizeTerminalParts(item.content.parts as UIMessage<unknown, any, any>["parts"], status),
            ...(metadata ? { metadata } : {}),
          },
          status: "failed",
          revision: sql`${threadItems.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(threadItems.id, item.id));
    }

    if (terminalFailure) {
      const calls = await tx
        .select()
        .from(toolEffects)
        .where(and(eq(toolEffects.turnId, input.runId), eq(toolEffects.attemptEpoch, input.attemptEpoch)));
      await finalizeTerminalToolEffects(tx, calls, {
        runId: input.runId,
        status,
        now,
        itemId: outputItemId,
      });
    }

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
      .where(
        and(
          eq(turnSteps.turnId, input.runId),
          eq(turnSteps.attemptEpoch, input.attemptEpoch),
          eq(turnSteps.status, "running"),
        ),
      );

    await tx
      .update(threadTurns)
      .set({
        status,
        error: error == null ? null : errorText(error).slice(0, 4000),
        outputItemId: outputItemId ?? undefined,
        inputTokens: input.inputTokens ?? undefined,
        outputTokens: input.outputTokens ?? undefined,
        cachedInputTokens: input.cachedInputTokens ?? undefined,
        reasoningTokens: input.reasoningTokens ?? undefined,
        totalTokens: input.totalTokens ?? undefined,
        completedAt: now,
      })
      .where(eq(threadTurns.id, input.runId));
    await tx
      .update(turnAttempts)
      .set({
        status,
        error: error == null ? null : errorText(error).slice(0, 4000),
        completedAt: now,
      })
      .where(and(eq(turnAttempts.turnId, input.runId), eq(turnAttempts.attemptEpoch, input.attemptEpoch)));
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

type JournalMessage = { id: string; content: PersistedThreadItemContent; status: "ok" | "failed" };

async function writeAssistantItem(
  tx: RuntimeTransaction,
  run: typeof threadTurns.$inferSelect,
  attempt: typeof turnAttempts.$inferSelect,
  sequence: bigint,
  message: JournalMessage,
) {
  const existing = run.outputItemId;
  const now = new Date();
  if (existing) {
    if (message.id !== existing) throw new Error("assistant output message id does not match its journal binding");
    const updated = await tx
      .update(threadItems)
      .set({
        content: message.content,
        status: message.status,
        revision: sql`${threadItems.revision} + 1`,
        updatedAt: now,
      })
      .where(and(eq(threadItems.id, existing), eq(threadItems.threadId, run.threadId)))
      .returning({ id: threadItems.id });
    if (!updated.length) throw new Error("assistant journal item is missing");
  } else {
    if (!attempt.historyItemId) throw new Error("run attempt has no journal parent");
    const siblings = await tx
      .select({ index: threadItems.branchIndex })
      .from(threadItems)
      .where(and(eq(threadItems.threadId, run.threadId), eq(threadItems.parentItemId, attempt.historyItemId)));
    await tx.insert(threadItems).values({
      ...message,
      threadId: run.threadId,
      turnId: run.id,
      ordinal: sequence + 1n,
      role: "assistant",
      parentItemId: attempt.historyItemId,
      branchIndex: siblings.reduce((next, row) => Math.max(next, row.index + 1), 0),
      createdAt: now,
      updatedAt: now,
    });
  }
  await tx
    .update(threads)
    .set({ selectedItemId: message.id, ...(!existing ? { itemSequence: sequence + 1n } : {}), updatedAt: now })
    .where(eq(threads.id, run.threadId));
  return message.id;
}

/** Persist the SDK's completed step before terminal cleanup. Reuse one assistant item for the entire turn. */
export async function persistCompletedStep(owner: RunLeaseToken, id: string, content: PersistedThreadItemContent) {
  await getDb().transaction(async (tx) => {
    const [binding] = await tx
      .select({ threadId: threadTurns.threadId })
      .from(threadTurns)
      .where(eq(threadTurns.id, owner.runId));
    if (!binding) throw new Error("missing run");
    const [thread] = await tx.select().from(threads).where(eq(threads.id, binding.threadId)).for("update");
    const [run] = await tx.select().from(threadTurns).where(eq(threadTurns.id, owner.runId)).for("update");
    const [attempt] = await tx
      .select()
      .from(turnAttempts)
      .where(and(eq(turnAttempts.turnId, owner.runId), eq(turnAttempts.attemptEpoch, owner.attemptEpoch)));
    await requireOwnedRun(tx, owner);
    if (!thread || !run || !attempt || attempt.historyRevision !== thread.historyRevision)
      throw new ConflictError("run history binding is no longer current", "run_history_conflict");
    await writeAssistantItem(tx, run, attempt, thread.itemSequence, { id, content, status: "ok" });
    await tx.update(threadTurns).set({ outputItemId: id }).where(eq(threadTurns.id, run.id));
  });
}

function awaitsClientContinuation(parts: unknown[]): boolean {
  return parts.some((part) => {
    if (!part || typeof part !== "object") return false;
    const tool = part as Record<string, unknown>;
    if (tool.state === "approval-requested") return true;
    if (tool.state !== "input-available" || tool.providerExecuted === true) return false;
    const metadata = tool.toolMetadata;
    if (!metadata || typeof metadata !== "object") return false;
    const agent = (metadata as Record<string, unknown>).agent;
    return !!agent && typeof agent === "object" && (agent as Record<string, unknown>).execution === "client";
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
    const [binding] = await tx
      .select({ threadId: threadTurns.threadId })
      .from(threadTurns)
      .where(eq(threadTurns.id, input.runId));
    if (!binding) throw new Error(`agent run ${input.runId} has no journal binding`);
    // Claim and finalization must acquire shared rows in the same order.
    // Otherwise an expired lease claim can deadlock with its old finalizer.
    const [session] = await tx
      .select({ historyRevision: threads.historyRevision, itemSequence: threads.itemSequence })
      .from(threads)
      .where(eq(threads.id, binding.threadId))
      .for("update");
    const [run] = await tx.select().from(threadTurns).where(eq(threadTurns.id, input.runId)).for("update");
    const [attempt] = await tx
      .select()
      .from(turnAttempts)
      .where(and(eq(turnAttempts.turnId, input.runId), eq(turnAttempts.attemptEpoch, input.attemptEpoch)))
      .for("update");
    if (!run || !attempt || !attempt.historyItemId || attempt.historyRevision == null) {
      throw new Error(`agent run ${input.runId} has no journal binding`);
    }
    const historyRevision = Number(attempt.historyRevision);
    if (["waiting", "completed", "failed", "cancelled", "interrupted"].includes(attempt.status)) {
      return { outputMessageId: run.outputItemId, historyRevision, status: attempt.status as AgentRunStatus };
    }
    await requireOwnedRun(tx, input);

    if (!session || session.historyRevision !== attempt.historyRevision) {
      throw new ConflictError("run history binding is no longer current", "run_history_conflict");
    }

    const now = new Date();
    const aborted = input.aborted || run.status === "cancel_requested" || input.status === "cancelled";
    const status: AgentRunStatus = aborted
      ? "cancelled"
      : input.status === "completed" && awaitsClientContinuation(input.parts)
        ? "waiting"
        : input.status;
    const terminalFailure = isTerminalFailureStatus(status);
    const error = input.error;
    const message: JournalMessage | null = input.message
      ? {
          ...input.message,
          status: status === "completed" || status === "waiting" ? "ok" : "failed",
          content: {
            ...input.message.content,
            parts: terminalFailure
              ? finalizeTerminalParts(input.message.content.parts as UIMessage<unknown, any, any>["parts"], status)
              : input.message.content.parts,
            ...(input.message.content.metadata
              ? {
                  metadata: {
                    ...input.message.content.metadata,
                    status:
                      status === "completed" || status === "waiting"
                        ? "completed"
                        : status === "cancelled"
                          ? "cancelled"
                          : "failed",
                  },
                }
              : {}),
          },
        }
      : null;
    const toolCalls = await tx
      .select()
      .from(toolEffects)
      .where(and(eq(toolEffects.turnId, input.runId), eq(toolEffects.attemptEpoch, input.attemptEpoch)));
    if (terminalFailure) {
      await finalizeTerminalToolEffects(tx, toolCalls, {
        runId: input.runId,
        status,
        now,
        itemId: message?.id ?? run.outputItemId,
      });
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
          .update(toolEffects)
          .set({
            status: terminal.status,
            outputJson: terminal.output === undefined ? undefined : asJsonValue(terminal.output),
            error: terminal.status === "failed" ? errorText(terminal.error).slice(0, 4000) : null,
            durationMs: Math.max(0, now.getTime() - toolCall.createdAt.getTime()),
            completedAt: now,
            itemId: message?.id ?? null,
          })
          .where(and(eq(toolEffects.turnId, input.runId), eq(toolEffects.id, toolCall.id)));
      }
    }

    const outputMessageId = message
      ? await writeAssistantItem(tx, run, attempt, session.itemSequence, message)
      : run.outputItemId;
    if (message)
      await tx
        .update(toolEffects)
        .set({ itemId: message.id })
        .where(and(eq(toolEffects.turnId, input.runId), eq(toolEffects.attemptEpoch, input.attemptEpoch)));

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
      .where(
        and(
          eq(turnSteps.turnId, input.runId),
          eq(turnSteps.attemptEpoch, input.attemptEpoch),
          eq(turnSteps.status, "running"),
        ),
      );
    await tx
      .update(threadTurns)
      .set({
        status,
        error: error == null ? null : errorText(error).slice(0, 4000),
        outputItemId: outputMessageId,
        inputTokens: input.inputTokens ?? undefined,
        outputTokens: input.outputTokens ?? undefined,
        cachedInputTokens: input.cachedInputTokens ?? undefined,
        reasoningTokens: input.reasoningTokens ?? undefined,
        totalTokens: input.totalTokens ?? undefined,
        completedAt: status === "waiting" ? null : now,
      })
      .where(eq(threadTurns.id, input.runId));
    await tx
      .update(turnAttempts)
      .set({
        status,
        error: error == null ? null : errorText(error).slice(0, 4000),
        completedAt: now,
      })
      .where(and(eq(turnAttempts.turnId, input.runId), eq(turnAttempts.attemptEpoch, input.attemptEpoch)));
    await tx
      .delete(turnLeases)
      .where(and(eq(turnLeases.turnId, input.runId), eq(turnLeases.attemptEpoch, input.attemptEpoch)));
    return { outputMessageId, historyRevision, status };
  });
}

export async function requestAgentRunCancellation(runId: string): Promise<void> {
  await getDb()
    .update(threadTurns)
    .set({ status: "cancel_requested" })
    .where(and(eq(threadTurns.id, runId), inArray(threadTurns.status, ["running", "cancel_requested"])));
}

export async function cancelWaitingAgentRun(
  sessionId: string,
  runId: string,
): Promise<"cancelled" | "active" | "terminal" | "missing"> {
  return getDb().transaction(async (tx) => {
    const [binding] = await tx
      .select({ threadId: threadTurns.threadId })
      .from(threadTurns)
      .where(eq(threadTurns.id, runId));
    if (!binding || binding.threadId !== sessionId) return "missing";

    const [session] = await tx.select().from(threads).where(eq(threads.id, sessionId)).for("update");
    const [run] = await tx.select().from(threadTurns).where(eq(threadTurns.id, runId)).for("update");
    if (!session || !run || run.threadId !== sessionId) return "missing";
    if (run.status === "running" || run.status === "cancel_requested") return "active";
    if (run.status !== "waiting") return "terminal";
    if (!run.outputItemId) throw new Error(`waiting Turn ${runId} has no assistant item`);

    const [attempt] = await tx
      .select()
      .from(turnAttempts)
      .where(eq(turnAttempts.turnId, runId))
      .orderBy(desc(turnAttempts.attemptEpoch))
      .limit(1)
      .for("update");
    if (!attempt || attempt.status !== "waiting") {
      throw new ConflictError("waiting Turn attempt state is inconsistent", "turn_snapshot_conflict");
    }
    const [item] = await tx
      .select()
      .from(threadItems)
      .where(and(eq(threadItems.id, run.outputItemId), eq(threadItems.threadId, sessionId)))
      .for("update");
    if (!item) throw new Error(`waiting Turn ${runId} assistant item does not exist`);

    const now = new Date();
    const metadata =
      item.content.metadata && typeof item.content.metadata === "object"
        ? { ...item.content.metadata, status: "cancelled" }
        : item.content.metadata;
    await tx
      .update(threadItems)
      .set({
        content: {
          ...item.content,
          parts: finalizeCancelledParts(item.content.parts as UIMessage<unknown, any, any>["parts"]),
          ...(metadata ? { metadata } : {}),
        },
        status: "failed",
        revision: sql`${threadItems.revision} + 1`,
        updatedAt: now,
      })
      .where(eq(threadItems.id, item.id));
    await tx
      .update(turnAttempts)
      .set({ status: "cancelled", error: "用户停止了待审批轮次", completedAt: now })
      .where(and(eq(turnAttempts.turnId, runId), eq(turnAttempts.attemptEpoch, attempt.attemptEpoch)));
    await tx
      .update(threadTurns)
      .set({ status: "cancelled", error: "用户停止了待审批轮次", completedAt: now })
      .where(eq(threadTurns.id, runId));
    await tx.delete(turnLeases).where(eq(turnLeases.turnId, runId));
    await tx
      .update(threads)
      .set({ historyRevision: sql`${threads.historyRevision} + 1`, updatedAt: now })
      .where(eq(threads.id, sessionId));
    return "cancelled";
  });
}

export async function isRunActive(runId: string): Promise<boolean> {
  const run = await getAgentRunById(runId);
  return run?.status === "running" || run?.status === "cancel_requested";
}

export async function listOrphanedRuns(now = new Date()): Promise<Array<{ id: string; sessionId: string }>> {
  return getDb()
    .select({ id: threadTurns.id, sessionId: threadTurns.threadId })
    .from(threadTurns)
    .leftJoin(turnLeases, eq(turnLeases.turnId, threadTurns.id))
    .where(
      and(
        inArray(threadTurns.status, ["running", "cancel_requested"]),
        or(isNull(turnLeases.turnId), lte(turnLeases.expiresAt, now)),
      ),
    );
}

/** Atomically classify an orphan from committed facts and, only for replay-safe
 * boundaries, fence the old writer with a new physical attempt. */
export async function claimOrphanedTurnRecovery(runId: string, now = new Date()): Promise<OrphanedTurnRecovery | null> {
  return getDb().transaction(async (tx) => {
    const [binding] = await tx
      .select({ threadId: threadTurns.threadId })
      .from(threadTurns)
      .where(eq(threadTurns.id, runId));
    if (!binding) return null;
    const [thread] = await tx.select().from(threads).where(eq(threads.id, binding.threadId)).for("update");
    if (!thread) return null;
    const [run] = await tx.select().from(threadTurns).where(eq(threadTurns.id, runId)).for("update");
    if (!run || !["running", "cancel_requested", "waiting"].includes(run.status)) return null;
    const [lease] = await tx.select().from(turnLeases).where(eq(turnLeases.turnId, runId)).for("update");
    if (lease && lease.expiresAt > now) return null;
    const [attempt] = await tx
      .select()
      .from(turnAttempts)
      .where(eq(turnAttempts.turnId, runId))
      .orderBy(desc(turnAttempts.attemptEpoch))
      .limit(1)
      .for("update");
    if (!attempt) throw new Error(`logical Turn ${runId} has no physical attempt`);
    if (lease && lease.attemptEpoch !== attempt.attemptEpoch) return null;
    const [envelope] = await tx
      .select()
      .from(turnResumeEnvelopes)
      .where(and(eq(turnResumeEnvelopes.turnId, runId), eq(turnResumeEnvelopes.attemptEpoch, attempt.attemptEpoch)));
    const effects = await tx
      .select({ status: toolEffects.status })
      .from(toolEffects)
      .where(eq(toolEffects.turnId, runId));
    const toolEffect = effects.some((effect) => effect.status === "running")
      ? "unconfirmed"
      : effects.some((effect) => effect.status === "completed")
        ? "committed"
        : "none";
    const hasResumeEnvelope =
      envelope !== undefined &&
      thread !== undefined &&
      envelope.threadId === run.threadId &&
      envelope.historyItemId === attempt.historyItemId &&
      envelope.historyRevision === attempt.historyRevision &&
      envelope.compactorVersion !== "" &&
      envelope.snapshot.schemaVersion === 2 &&
      envelope.snapshot.execution.providerBinding.id === run.providerId &&
      envelope.snapshot.execution.providerBinding.model === run.model &&
      (run.outputItemId === null || envelope.snapshot.execution.assistantMessageId === run.outputItemId);
    const decision = classifyTurnRecovery({
      hasResumeEnvelope,
      cancellationRequested: run.status === "cancel_requested",
      waitingForClient: run.status === "waiting",
      committedStep: run.outputItemId !== null,
      toolEffect,
    });
    if (decision === "resume-waiting") return { state: "stable", decision };

    if (decision === "interrupt" || decision === "reconcile-effect") {
      const error =
        decision === "reconcile-effect"
          ? "orphaned Turn has an unconfirmed tool effect"
          : run.status === "cancel_requested"
            ? "orphaned Turn was cancelled"
            : toolEffect === "committed" && run.outputItemId === null
              ? "orphaned Turn has a committed tool effect without a journaled SDK step"
              : "orphaned Turn has no complete resume envelope";
      await tx
        .update(turnAttempts)
        .set({ status: "interrupted", completedAt: now, error })
        .where(
          and(
            eq(turnAttempts.turnId, runId),
            eq(turnAttempts.attemptEpoch, attempt.attemptEpoch),
            eq(turnAttempts.status, "running"),
          ),
        );
      await tx
        .update(threadTurns)
        .set({ status: "interrupted", completedAt: now, error })
        .where(and(eq(threadTurns.id, runId), inArray(threadTurns.status, ["running", "cancel_requested"])));
      if (lease) await tx.delete(turnLeases).where(eq(turnLeases.turnId, runId));
      return { state: "interrupted", decision };
    }

    if (!envelope || !attempt.historyItemId || attempt.historyRevision == null) {
      throw new Error(`logical Turn ${runId} lost its recovery binding after classification`);
    }
    const attemptEpoch = attempt.attemptEpoch + 1n;
    await tx
      .update(turnAttempts)
      .set({ status: "interrupted", completedAt: now, error: "attempt lease expired" })
      .where(
        and(
          eq(turnAttempts.turnId, runId),
          eq(turnAttempts.attemptEpoch, attempt.attemptEpoch),
          eq(turnAttempts.status, "running"),
        ),
      );
    if (lease) await tx.delete(turnLeases).where(eq(turnLeases.turnId, runId));
    await tx.insert(turnAttempts).values({
      turnId: runId,
      attemptEpoch,
      threadId: run.threadId,
      operation: "recovery",
      targetItemId: attempt.targetItemId,
      historyItemId: attempt.historyItemId,
      historyRevision: attempt.historyRevision,
      status: "running",
      startedAt: now,
    });
    const [copied] = await tx
      .insert(turnResumeEnvelopes)
      .values({
        ...envelope,
        attemptEpoch,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!copied) throw new Error(`logical Turn ${runId} recovery envelope was not copied`);
    await tx.insert(turnLeases).values({
      threadId: run.threadId,
      turnId: runId,
      attemptEpoch,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + RUN_LEASE_MS),
    });
    await tx
      .update(threadTurns)
      .set({ status: "running", error: null, completedAt: null })
      .where(eq(threadTurns.id, runId));
    return {
      state: "claimed",
      decision,
      token: { runId, attemptEpoch },
      envelope: turnResumeEnvelopeFromRow(copied),
    };
  });
}

export async function interruptRuns(runIds: string[]): Promise<Array<{ id: string; sessionId: string }>> {
  if (runIds.length === 0) {
    return [];
  }
  return getDb().transaction(async (tx) => {
    // Each lock wait can cross an ownership handoff. PostgreSQL READ COMMITTED
    // takes a fresh snapshot for the eligibility check after acquiring the locks.
    await tx
      .select({ id: threads.id })
      .from(threads)
      .innerJoin(threadTurns, eq(threadTurns.threadId, threads.id))
      .where(inArray(threadTurns.id, runIds))
      .orderBy(threads.id)
      .for("update", { of: threads });
    await tx
      .select({ id: threadTurns.id })
      .from(threadTurns)
      .where(inArray(threadTurns.id, runIds))
      .orderBy(threadTurns.id)
      .for("update");
    await tx
      .select({ id: turnLeases.turnId })
      .from(turnLeases)
      .where(inArray(turnLeases.turnId, runIds))
      .orderBy(turnLeases.turnId)
      .for("update");
    const now = new Date();
    const interrupted = await tx
      .update(threadTurns)
      .set({ status: "interrupted", completedAt: now })
      .where(
        and(
          inArray(threadTurns.id, runIds),
          inArray(threadTurns.status, ["running", "cancel_requested"]),
          notExists(
            tx
              .select({ turnId: turnLeases.turnId })
              .from(turnLeases)
              .where(and(eq(turnLeases.turnId, threadTurns.id), gt(turnLeases.expiresAt, now))),
          ),
        ),
      )
      .returning({ id: threadTurns.id, sessionId: threadTurns.threadId });
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
    await tx
      .update(turnAttempts)
      .set({ status: "interrupted", error: "turn ownership was lost", completedAt: now })
      .where(and(inArray(turnAttempts.turnId, interruptedIds), eq(turnAttempts.status, "running")));
    await tx.delete(turnLeases).where(inArray(turnLeases.turnId, interruptedIds));
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
  attemptEpoch: bigint;
  sessionId: string;
  providerId: string;
  model: string;
}): Promise<{ responseId: string; outputMessageId: string; inputTokens: number | null } | null> {
  const [latestRun] = await getDb()
    .select({
      id: threadTurns.id,
      attemptEpoch: turnAttempts.attemptEpoch,
      outputMessageId: threadTurns.outputItemId,
      providerId: threadTurns.providerId,
      model: threadTurns.model,
    })
    .from(turnAttempts)
    .innerJoin(threadTurns, eq(threadTurns.id, turnAttempts.turnId))
    .where(
      and(
        eq(threadTurns.threadId, input.sessionId),
        inArray(turnAttempts.status, ["waiting", "completed"]),
        or(ne(threadTurns.id, input.runId), sql`${turnAttempts.attemptEpoch} < ${input.attemptEpoch}`),
      ),
    )
    .orderBy(desc(threadTurns.ordinal), desc(turnAttempts.attemptEpoch))
    .limit(1);
  if (!latestRun?.outputMessageId || latestRun.providerId !== input.providerId || latestRun.model !== input.model) {
    return null;
  }
  const [[row], [outputMessage]] = await Promise.all([
    getDb()
      .select({ metadata: turnSteps.metadata, inputTokens: turnSteps.inputTokens, status: turnSteps.status })
      .from(turnSteps)
      .where(
        and(
          eq(turnSteps.turnId, latestRun.id),
          eq(turnSteps.attemptEpoch, latestRun.attemptEpoch),
          eq(turnSteps.kind, "model"),
        ),
      )
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
  const [run] = await db.select().from(threadTurns).where(eq(threadTurns.id, runId));
  if (!run) {
    return null;
  }
  const steps = await db
    .select()
    .from(turnSteps)
    .where(eq(turnSteps.turnId, runId))
    .orderBy(asc(turnSteps.attemptEpoch), asc(turnSteps.stepIndex));
  const toolCalls = await db
    .select()
    .from(toolEffects)
    .where(eq(toolEffects.turnId, runId))
    .orderBy(asc(toolEffects.createdAt));
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
      runId: threadTurns.id,
      attemptEpoch: turnSteps.attemptEpoch,
      stepId: turnSteps.id,
      providerId: threadTurns.providerId,
      model: threadTurns.model,
      metadata: turnSteps.metadata,
      inputTokens: turnSteps.inputTokens,
      runCreatedAt: threadTurns.createdAt,
      finishedAt: turnSteps.completedAt,
    })
    .from(turnSteps)
    .innerJoin(threadTurns, eq(threadTurns.id, turnSteps.turnId))
    .where(
      and(
        eq(threadTurns.threadId, sessionId),
        eq(turnSteps.kind, "model"),
        inArray(turnSteps.status, ["completed", "failed"]),
        sql`${turnSteps.metadata}->'context_snapshot' IS NOT NULL`,
      ),
    )
    .orderBy(
      desc(threadTurns.ordinal),
      desc(turnSteps.attemptEpoch),
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
      .where(
        and(
          eq(turnSteps.id, stepId),
          eq(turnSteps.turnId, token.runId),
          eq(turnSteps.attemptEpoch, token.attemptEpoch),
        ),
      );
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
        attemptEpoch: input.attemptEpoch,
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
      .where(
        and(
          eq(turnSteps.id, input.stepId),
          eq(turnSteps.turnId, input.runId),
          eq(turnSteps.attemptEpoch, input.attemptEpoch),
        ),
      );
  });
}

export async function recordToolCallStart(input: {
  runId: string;
  attemptEpoch: bigint;
  toolCallId: string;
  stepIndex?: number | null;
  toolName: string;
  toolInput: unknown;
  observedToolInput?: unknown;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, input);
    await tx
      .insert(toolEffects)
      .values({
        id: input.toolCallId,
        turnId: input.runId,
        attemptEpoch: input.attemptEpoch,
        stepIndex: input.stepIndex ?? null,
        toolName: input.toolName,
        status: "running",
        inputDigest: toolInputDigest(input.toolInput),
        inputJson: asJsonValue(input.observedToolInput ?? input.toolInput),
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: [toolEffects.turnId, toolEffects.id] });
  });
}

export type ToolEffectClaim = { state: "execute" } | { state: "replay"; output: unknown };

/** Claim a provider tool-call identity before entering host code.
 * Completed effects are replayed; every existing nonterminal claim fails closed. */
export async function claimToolEffect(input: {
  runId: string;
  attemptEpoch: bigint;
  toolCallId: string;
  toolName: string;
  toolInput: unknown;
  observedToolInput?: unknown;
  stepIndex?: number | null;
}): Promise<ToolEffectClaim> {
  return getDb().transaction(async (tx) => {
    await requireOwnedRun(tx, input);
    const inputDigest = toolInputDigest(input.toolInput);
    const [existing] = await tx
      .select()
      .from(toolEffects)
      .where(and(eq(toolEffects.turnId, input.runId), eq(toolEffects.id, input.toolCallId)))
      .for("update");
    if (!existing) {
      await tx.insert(toolEffects).values({
        id: input.toolCallId,
        turnId: input.runId,
        attemptEpoch: input.attemptEpoch,
        stepIndex: input.stepIndex ?? null,
        toolName: input.toolName,
        status: "running",
        inputDigest,
        inputJson: asJsonValue(input.observedToolInput ?? input.toolInput),
        createdAt: new Date(),
      });
      return { state: "execute" };
    }
    if (existing.toolName !== input.toolName || existing.inputDigest !== inputDigest) {
      throw new ConflictError(
        "tool effect identity is already bound to different input",
        "tool_effect_identity_conflict",
      );
    }
    if (existing.status === "completed") {
      return { state: "replay", output: existing.outputJson };
    }
    if (existing.status === "failed") {
      throw new ConflictError(existing.error ?? "tool effect previously failed", "tool_effect_failed");
    }
    throw new ConflictError(
      existing.attemptEpoch === input.attemptEpoch
        ? "tool effect is already claimed by this attempt"
        : "tool effect from an older attempt requires reconciliation",
      "tool_effect_unconfirmed",
    );
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
      .update(toolEffects)
      .set({
        status: input.status,
        outputJson: input.output === undefined ? undefined : asJsonValue(input.output),
        error: input.error == null ? null : errorText(input.error).slice(0, 4000),
        durationMs: input.durationMs ?? null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(toolEffects.id, input.toolCallId),
          eq(toolEffects.turnId, input.runId),
          eq(toolEffects.attemptEpoch, input.attemptEpoch),
        ),
      );
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
