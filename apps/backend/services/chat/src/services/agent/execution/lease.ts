import { and, eq, lte } from "drizzle-orm";

import { getDb } from "../../../db/index.js";
import { conversationRunLeases } from "../../../db/schema.js";
import { ConflictError } from "../../../lib/errors.js";
import { cancelArtifactGeneration, listUnfinishedArtifactGenerations } from "../../../clients/knowledge.js";
import { finishAgentRun, getAgentRunById, requestAgentRunCancellation } from "../persistence/repository.js";

const controllers = new Map<string, AbortController>();
const heartbeats = new Map<string, ReturnType<typeof setInterval>>();
const cancellationPolls = new Map<string, ReturnType<typeof setInterval>>();
const LEASE_MS = 10 * 60_000;
const CANCELLATION_POLL_MS = 1_000;

export async function acquireRunLease(conversationId: string, runId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  const expired = await db
    .select()
    .from(conversationRunLeases)
    .where(and(eq(conversationRunLeases.conversationId, conversationId), lte(conversationRunLeases.expiresAt, now)));
  await db
    .delete(conversationRunLeases)
    .where(and(eq(conversationRunLeases.conversationId, conversationId), lte(conversationRunLeases.expiresAt, now)));
  await Promise.all(expired.map((lease) =>
    finishAgentRun({ runId: lease.runId, status: "interrupted" }).catch(() => undefined),
  ));
  const [active] = await db
    .select()
    .from(conversationRunLeases)
    .where(eq(conversationRunLeases.conversationId, conversationId));
  if (active) {
    throw new ConflictError("this conversation already has an active run", "active_run_exists", {
      run_id: active.runId,
    });
  }
  try {
    await db.insert(conversationRunLeases).values({
      conversationId,
      runId,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + LEASE_MS),
    });
  } catch {
    throw new ConflictError("this conversation already has an active run", "active_run_exists");
  }
}

export function registerRunController(runId: string): AbortSignal {
  const controller = new AbortController();
  controllers.set(runId, controller);
  heartbeats.set(runId, setInterval(() => {
    const now = new Date();
    void getDb().update(conversationRunLeases).set({
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + LEASE_MS),
    }).where(eq(conversationRunLeases.runId, runId)).catch((error) =>
      console.error("[chat-agent] run lease heartbeat failed", error),
    );
  }, 60_000));
  cancellationPolls.set(runId, setInterval(() => {
    void getAgentRunById(runId)
      .then((run) => {
        if (run?.status === "cancel_requested") {
          controller.abort(new DOMException("agent run cancelled", "AbortError"));
        }
      })
      .catch((error) => console.error("[chat-agent] cancellation poll failed", error));
  }, CANCELLATION_POLL_MS));
  return controller.signal;
}

export async function releaseRun(runId: string): Promise<void> {
  controllers.delete(runId);
  const heartbeat = heartbeats.get(runId);
  if (heartbeat) clearInterval(heartbeat);
  heartbeats.delete(runId);
  const cancellationPoll = cancellationPolls.get(runId);
  if (cancellationPoll) clearInterval(cancellationPoll);
  cancellationPolls.delete(runId);
  await getDb().delete(conversationRunLeases).where(eq(conversationRunLeases.runId, runId));
}

export async function cancelRun(conversationId: string, runId: string): Promise<boolean> {
  const run = await getAgentRunById(runId);
  if (!run || run.conversationId !== conversationId) return false;
  await requestAgentRunCancellation(runId);
  controllers.get(runId)?.abort(new DOMException("agent run cancelled", "AbortError"));
  const jobs = await listUnfinishedArtifactGenerations({ userId: run.userId, runId });
  await Promise.all(jobs.map((job) =>
    cancelArtifactGeneration({ userId: run.userId, generationId: job.id }).catch(() => undefined),
  ));
  return true;
}
