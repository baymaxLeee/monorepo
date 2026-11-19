import type { AgentRunInputChannel, AgentRunInputMode, AgentRunInputOutcome } from "@repo/agent-runtime/agent/steering";
import { and, eq } from "drizzle-orm";

import { logger } from "../../../infrastructure/observability/logger.js";
import { getDb } from "../../../infrastructure/persistence/index.js";
import { agentRuns, agentRunInputs, sessions, sessionRunLeases } from "../../../infrastructure/persistence/schema.js";
import { ConflictError, NotFoundError } from "../../errors.js";

export type AgentRunInputState = "accepted" | "dispatching" | "delivered" | "not_delivered" | "unconfirmed";
export interface AgentRunInputView {
  clientMessageId: string;
  runId: string;
  mode: AgentRunInputMode;
  text: string;
  state: AgentRunInputState;
  stepNumber: number | null;
  reason: string | null;
}

function view(row: typeof agentRunInputs.$inferSelect): AgentRunInputView {
  return {
    clientMessageId: row.clientMessageId,
    runId: row.runId,
    mode: row.mode as AgentRunInputMode,
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
  mode: AgentRunInputMode;
  text: string;
}): Promise<AgentRunInputView> {
  return getDb().transaction(async (tx) => {
    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)))
      .for("update");
    if (!session) throw new NotFoundError("session not found");
    const [run] = await tx.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).for("update");
    if (!run || run.sessionId !== input.sessionId || run.userId !== input.userId) {
      throw new NotFoundError("agent run not found");
    }
    const [existing] = await tx
      .select()
      .from(agentRunInputs)
      .where(and(eq(agentRunInputs.runId, input.runId), eq(agentRunInputs.clientMessageId, input.clientMessageId)));
    if (existing) {
      if (existing.sessionId !== input.sessionId || existing.mode !== input.mode || existing.text !== input.text) {
        throw new ConflictError("run input id is already bound to different content", "run_input_id_conflict");
      }
      return view(existing);
    }
    const [lease] = await tx
      .select({ runId: sessionRunLeases.runId })
      .from(sessionRunLeases)
      .where(eq(sessionRunLeases.sessionId, input.sessionId));
    if (run.status !== "running" || lease?.runId !== input.runId) {
      throw new ConflictError("agent run no longer accepts input", "agent_run_not_accepting_input");
    }
    const now = new Date();
    await tx.insert(agentRunInputs).values({
      runId: input.runId,
      clientMessageId: input.clientMessageId,
      sessionId: input.sessionId,
      mode: input.mode,
      text: input.text,
      state: "accepted",
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await tx
      .select()
      .from(agentRunInputs)
      .where(and(eq(agentRunInputs.runId, input.runId), eq(agentRunInputs.clientMessageId, input.clientMessageId)));
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
    .select()
    .from(agentRunInputs)
    .innerJoin(agentRuns, eq(agentRuns.id, agentRunInputs.runId))
    .where(
      and(
        eq(agentRunInputs.runId, input.runId),
        eq(agentRunInputs.clientMessageId, input.clientMessageId),
        eq(agentRunInputs.sessionId, input.sessionId),
        eq(agentRuns.userId, input.userId),
      ),
    );
  if (!row) throw new NotFoundError("run input not found");
  return view(row.agent_run_inputs);
}

export async function listAgentRunInputs(input: {
  sessionId: string;
  runId: string;
  userId: string;
}): Promise<AgentRunInputView[]> {
  const rows = await getDb()
    .select()
    .from(agentRunInputs)
    .innerJoin(agentRuns, eq(agentRuns.id, agentRunInputs.runId))
    .where(
      and(
        eq(agentRunInputs.runId, input.runId),
        eq(agentRunInputs.sessionId, input.sessionId),
        eq(agentRuns.userId, input.userId),
      ),
    )
    .orderBy(agentRunInputs.createdAt);
  if (rows.length === 0) {
    const [run] = await getDb()
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, input.runId),
          eq(agentRuns.sessionId, input.sessionId),
          eq(agentRuns.userId, input.userId),
        ),
      );
    if (!run) throw new NotFoundError("agent run not found");
  }
  return rows.map((row) => view(row.agent_run_inputs));
}

async function settle(runId: string, clientMessageId: string, outcome: AgentRunInputOutcome): Promise<void> {
  await getDb()
    .update(agentRunInputs)
    .set(
      outcome.type === "delivered"
        ? { state: "delivered", stepNumber: outcome.stepNumber, reason: null, updatedAt: new Date() }
        : { state: "not_delivered", reason: outcome.reason, updatedAt: new Date() },
    )
    .where(
      and(
        eq(agentRunInputs.runId, runId),
        eq(agentRunInputs.clientMessageId, clientMessageId),
        eq(agentRunInputs.state, "dispatching"),
      ),
    );
}

export function startAgentRunInputInbox(runId: string, inputChannel: AgentRunInputChannel) {
  let closed = false;
  let polling: Promise<void> | null = null;
  const settlements = new Set<Promise<void>>();
  const poll = async () => {
    if (closed || polling) return polling;
    polling = (async () => {
      const rows = await getDb()
        .update(agentRunInputs)
        .set({ state: "dispatching", updatedAt: new Date() })
        .where(and(eq(agentRunInputs.runId, runId), eq(agentRunInputs.state, "accepted")))
        .returning();
      rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (const row of rows) {
        const outcome = inputChannel
          .submit(row.text, { id: row.clientMessageId, mode: row.mode as AgentRunInputMode })
          .then((result) => settle(runId, row.clientMessageId, result))
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
      await Promise.allSettled([...settlements]);
    },
  };
}
