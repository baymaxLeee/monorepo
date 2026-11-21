import type { RuntimeInputMode, RuntimeInputOutcome, RuntimeInputQueue } from "@repo/agent-runtime";
import { and, eq, gt } from "drizzle-orm";

import { logger } from "../../../infrastructure/observability/logger.js";
import { getDb } from "../../../infrastructure/persistence/index.js";
import { threads, turnInputs, turnLeases, turns } from "../../../infrastructure/persistence/schema.js";
import { ConflictError, NotFoundError } from "../../errors.js";
import { withRunLease, type RunLeaseToken } from "./repository.js";

export type AgentRunInputState = "accepted" | "dispatching" | "delivered" | "not_delivered" | "unconfirmed";
export interface AgentRunInputView {
  clientMessageId: string;
  runId: string;
  mode: RuntimeInputMode;
  text: string;
  state: AgentRunInputState;
  stepNumber: number | null;
  reason: string | null;
}

function view(row: typeof turnInputs.$inferSelect): AgentRunInputView {
  return {
    clientMessageId: row.id,
    runId: row.turnId,
    mode: row.mode as RuntimeInputMode,
    text: row.text,
    state: row.state as AgentRunInputState,
    stepNumber: row.stepNumber,
    reason: row.reason,
  };
}

export async function acceptAgentRunInput(input: {
  sessionId: string;
  runId: string;
  userId: string;
  clientMessageId: string;
  mode: RuntimeInputMode;
  text: string;
}): Promise<AgentRunInputView> {
  return getDb().transaction(async (tx) => {
    const [session] = await tx
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.id, input.sessionId), eq(threads.userId, input.userId)))
      .for("update");
    if (!session) throw new NotFoundError("session not found");
    const [run] = await tx.select().from(turns).where(eq(turns.id, input.runId)).for("update");
    if (!run || run.threadId !== input.sessionId || run.userId !== input.userId) {
      throw new NotFoundError("agent run not found");
    }
    const [existing] = await tx
      .select()
      .from(turnInputs)
      .where(and(eq(turnInputs.turnId, input.runId), eq(turnInputs.id, input.clientMessageId)));
    if (existing) {
      if (existing.threadId !== input.sessionId || existing.mode !== input.mode || existing.text !== input.text) {
        throw new ConflictError("run input id is already bound to different content", "run_input_id_conflict");
      }
      return view(existing);
    }
    const [lease] = await tx
      .select({ turnId: turnLeases.turnId })
      .from(turnLeases)
      .where(and(eq(turnLeases.threadId, input.sessionId), gt(turnLeases.expiresAt, new Date())));
    if (run.status !== "running" || lease?.turnId !== input.runId) {
      throw new ConflictError("agent run no longer accepts input", "agent_run_not_accepting_input");
    }
    const now = new Date();
    await tx.insert(turnInputs).values({
      turnId: input.runId,
      id: input.clientMessageId,
      threadId: input.sessionId,
      mode: input.mode,
      text: input.text,
      state: "accepted",
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await tx
      .select()
      .from(turnInputs)
      .where(and(eq(turnInputs.turnId, input.runId), eq(turnInputs.id, input.clientMessageId)));
    if (!row) throw new Error("run input admission was not persisted");
    return view(row);
  });
}

export async function getAgentRunInput(input: {
  sessionId: string;
  runId: string;
  userId: string;
  clientMessageId: string;
}): Promise<AgentRunInputView> {
  const [row] = await getDb()
    .select({ input: turnInputs })
    .from(turnInputs)
    .innerJoin(turns, eq(turns.id, turnInputs.turnId))
    .where(
      and(
        eq(turnInputs.turnId, input.runId),
        eq(turnInputs.id, input.clientMessageId),
        eq(turnInputs.threadId, input.sessionId),
        eq(turns.userId, input.userId),
      ),
    );
  if (!row) throw new NotFoundError("run input not found");
  return view(row.input);
}

export async function listAgentRunInputs(input: {
  sessionId: string;
  runId: string;
  userId: string;
}): Promise<AgentRunInputView[]> {
  const rows = await getDb()
    .select({ input: turnInputs })
    .from(turnInputs)
    .innerJoin(turns, eq(turns.id, turnInputs.turnId))
    .where(
      and(eq(turnInputs.turnId, input.runId), eq(turnInputs.threadId, input.sessionId), eq(turns.userId, input.userId)),
    )
    .orderBy(turnInputs.createdAt);
  if (rows.length === 0) {
    const [run] = await getDb()
      .select({ id: turns.id })
      .from(turns)
      .where(and(eq(turns.id, input.runId), eq(turns.threadId, input.sessionId), eq(turns.userId, input.userId)));
    if (!run) throw new NotFoundError("agent run not found");
  }
  return rows.map((row) => view(row.input));
}

async function settle(token: RunLeaseToken, clientMessageId: string, outcome: RuntimeInputOutcome): Promise<void> {
  await withRunLease(token, async (tx) =>
    tx
      .update(turnInputs)
      .set(
        outcome.type === "delivered"
          ? { state: "delivered", stepNumber: outcome.stepNumber, reason: null, updatedAt: new Date() }
          : { state: "not_delivered", reason: outcome.reason, updatedAt: new Date() },
      )
      .where(
        and(
          eq(turnInputs.turnId, token.runId),
          eq(turnInputs.id, clientMessageId),
          eq(turnInputs.state, "dispatching"),
        ),
      ),
  );
}

export function startAgentRunInputInbox(token: RunLeaseToken, inputChannel: RuntimeInputQueue) {
  const { runId } = token;
  let closed = false;
  let polling: Promise<void> | null = null;
  const settlements = new Set<Promise<void>>();
  const poll = async () => {
    if (closed || polling) return polling;
    polling = (async () => {
      const rows = await withRunLease(token, async (tx) =>
        tx
          .update(turnInputs)
          .set({ state: "dispatching", updatedAt: new Date() })
          .where(and(eq(turnInputs.turnId, runId), eq(turnInputs.state, "accepted")))
          .returning(),
      );
      rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (const row of rows) {
        const outcome = inputChannel
          .submit(row.text, { id: row.id, mode: row.mode as RuntimeInputMode })
          .then((result) => settle(token, row.id, result))
          .catch((err) => logger.error({ err, runId, inputId: row.id }, "input settlement failed"))
          .finally(() => settlements.delete(outcome));
        settlements.add(outcome);
      }
    })().finally(() => {
      polling = null;
    });
    return polling;
  };
  const reportPollError = (error: unknown) => logger.error({ err: error, runId }, "agent run input inbox poll failed");
  const timer = setInterval(() => void poll().catch(reportPollError), 100);
  timer.unref();
  void poll().catch(reportPollError);
  return {
    async close() {
      closed = true;
      clearInterval(timer);
      await polling;
      await Promise.allSettled(settlements);
    },
  };
}
