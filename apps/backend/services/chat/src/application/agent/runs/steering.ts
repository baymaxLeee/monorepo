import type { AgentSteering, AgentSteeringOutcome } from "@backend/agent-runtime-ts/steering";
import { and, eq } from "drizzle-orm";

import { logger } from "../../../infrastructure/observability/logger.js";
import { getDb } from "../../../infrastructure/persistence/index.js";
import {
  agentRuns,
  agentSteeringInputs,
  conversations,
  conversationRunLeases,
} from "../../../infrastructure/persistence/schema.js";
import { ConflictError, NotFoundError } from "../../errors.js";

export type AgentSteeringInputState = "accepted" | "dispatching" | "delivered" | "not_delivered" | "unconfirmed";
export interface AgentSteeringInputView {
  clientMessageId: string;
  runId: string;
  delivery: "steer" | "queue";
  text: string;
  state: AgentSteeringInputState;
  stepNumber: number | null;
  reason: string | null;
}

function view(row: typeof agentSteeringInputs.$inferSelect): AgentSteeringInputView {
  return {
    clientMessageId: row.clientMessageId,
    runId: row.runId,
    delivery: row.delivery as "steer" | "queue",
    text: row.text,
    state: row.state as AgentSteeringInputState,
    stepNumber: row.stepNumber,
    reason: row.reason,
  };
}

export async function acceptAgentSteeringInput(input: {
  conversationId: string;
  runId: string;
  userId: string;
  clientMessageId: string;
  delivery: "steer" | "queue";
  text: string;
}): Promise<AgentSteeringInputView> {
  return getDb().transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)))
      .for("update");
    if (!conversation) throw new NotFoundError("conversation not found");
    const [run] = await tx.select().from(agentRuns).where(eq(agentRuns.id, input.runId)).for("update");
    if (!run || run.conversationId !== input.conversationId || run.userId !== input.userId) {
      throw new NotFoundError("agent run not found");
    }
    const [existing] = await tx
      .select()
      .from(agentSteeringInputs)
      .where(
        and(eq(agentSteeringInputs.runId, input.runId), eq(agentSteeringInputs.clientMessageId, input.clientMessageId)),
      );
    if (existing) {
      if (
        existing.conversationId !== input.conversationId ||
        existing.delivery !== input.delivery ||
        existing.text !== input.text
      ) {
        throw new ConflictError(
          "steering input id is already bound to different content",
          "steering_input_id_conflict",
        );
      }
      return view(existing);
    }
    const [lease] = await tx
      .select({ runId: conversationRunLeases.runId })
      .from(conversationRunLeases)
      .where(eq(conversationRunLeases.conversationId, input.conversationId));
    if (run.status !== "running" || lease?.runId !== input.runId) {
      throw new ConflictError("agent run is no longer steerable", "agent_run_not_steerable");
    }
    const now = new Date();
    await tx.insert(agentSteeringInputs).values({
      runId: input.runId,
      clientMessageId: input.clientMessageId,
      conversationId: input.conversationId,
      delivery: input.delivery,
      text: input.text,
      state: "accepted",
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await tx
      .select()
      .from(agentSteeringInputs)
      .where(
        and(eq(agentSteeringInputs.runId, input.runId), eq(agentSteeringInputs.clientMessageId, input.clientMessageId)),
      );
    if (!row) throw new Error("steering input admission was not persisted");
    return view(row);
  });
}

export async function getAgentSteeringInput(input: {
  conversationId: string;
  runId: string;
  userId: string;
  clientMessageId: string;
}): Promise<AgentSteeringInputView> {
  const [row] = await getDb()
    .select()
    .from(agentSteeringInputs)
    .innerJoin(agentRuns, eq(agentRuns.id, agentSteeringInputs.runId))
    .where(
      and(
        eq(agentSteeringInputs.runId, input.runId),
        eq(agentSteeringInputs.clientMessageId, input.clientMessageId),
        eq(agentSteeringInputs.conversationId, input.conversationId),
        eq(agentRuns.userId, input.userId),
      ),
    );
  if (!row) throw new NotFoundError("steering input not found");
  return view(row.agent_steering_inputs);
}

export async function listAgentSteeringInputs(input: {
  conversationId: string;
  runId: string;
  userId: string;
}): Promise<AgentSteeringInputView[]> {
  const rows = await getDb()
    .select()
    .from(agentSteeringInputs)
    .innerJoin(agentRuns, eq(agentRuns.id, agentSteeringInputs.runId))
    .where(
      and(
        eq(agentSteeringInputs.runId, input.runId),
        eq(agentSteeringInputs.conversationId, input.conversationId),
        eq(agentRuns.userId, input.userId),
      ),
    )
    .orderBy(agentSteeringInputs.createdAt);
  if (rows.length === 0) {
    const [run] = await getDb()
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, input.runId),
          eq(agentRuns.conversationId, input.conversationId),
          eq(agentRuns.userId, input.userId),
        ),
      );
    if (!run) throw new NotFoundError("agent run not found");
  }
  return rows.map((row) => view(row.agent_steering_inputs));
}

async function settle(runId: string, clientMessageId: string, outcome: AgentSteeringOutcome): Promise<void> {
  await getDb()
    .update(agentSteeringInputs)
    .set(
      outcome.type === "delivered"
        ? { state: "delivered", stepNumber: outcome.stepNumber, reason: null, updatedAt: new Date() }
        : { state: "not_delivered", reason: outcome.reason, updatedAt: new Date() },
    )
    .where(
      and(
        eq(agentSteeringInputs.runId, runId),
        eq(agentSteeringInputs.clientMessageId, clientMessageId),
        eq(agentSteeringInputs.state, "dispatching"),
      ),
    );
}

export function startAgentSteeringInbox(runId: string, steering: AgentSteering) {
  let closed = false;
  let polling: Promise<void> | null = null;
  const settlements = new Set<Promise<void>>();
  const poll = async () => {
    if (closed || polling) return polling;
    polling = (async () => {
      const rows = await getDb()
        .update(agentSteeringInputs)
        .set({ state: "dispatching", updatedAt: new Date() })
        .where(and(eq(agentSteeringInputs.runId, runId), eq(agentSteeringInputs.state, "accepted")))
        .returning();
      rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (const row of rows) {
        const outcome = (
          row.delivery === "queue"
            ? steering.queue(row.text, { id: row.clientMessageId })
            : steering.steer(row.text, { id: row.clientMessageId })
        )
          .then((result) => settle(runId, row.clientMessageId, result))
          .finally(() => settlements.delete(outcome));
        settlements.add(outcome);
      }
    })().finally(() => {
      polling = null;
    });
    return polling;
  };
  const reportPollError = (error: unknown) => logger.error({ err: error, runId }, "agent steering inbox poll failed");
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
