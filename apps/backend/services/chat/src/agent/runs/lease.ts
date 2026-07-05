import { and, eq, lte } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { conversationRunLeases } from "../../db/schema.js";
import { ConflictError } from "../../lib/errors.js";
import { deactivateAgentStream } from "../streams/service.js";
import {
  finishAgentRun,
  getAgentRunById,
  interruptRuns,
  listOrphanedRuns,
  requestAgentRunCancellation,
} from "./repository.js";

const controllers = new Map<string, AbortController>();
const completions = new Map<string, { promise: Promise<void>; resolve: () => void }>();
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
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  completions.set(runId, { promise, resolve });
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
  completions.get(runId)?.resolve();
  completions.delete(runId);
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
  const completion = completions.get(runId)?.promise;
  controllers.get(runId)?.abort(new DOMException("agent run cancelled", "AbortError"));
  await completion;
  return true;
}

export async function reconcileOrphanedRuns(): Promise<void> {
  const orphaned = await listOrphanedRuns();
  if (orphaned.length === 0) return;
  await interruptRuns(orphaned.map((run) => run.id));
  await Promise.all(
    orphaned.map((run) =>
      deactivateAgentStream(run.conversationId, run.id).catch((error) =>
        console.error("[chat-agent] failed to clear stream flag for orphaned run", run.id, error),
      ),
    ),
  );
  await getDb().delete(conversationRunLeases);
  console.info(`[chat-agent] reconciled ${orphaned.length} orphaned run(s) on boot`);
}
