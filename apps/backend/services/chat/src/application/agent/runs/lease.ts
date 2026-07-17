import { and, eq, inArray, lte } from "drizzle-orm";

import { getDb } from "../../../infrastructure/persistence/index.js";
import { conversationRunLeases } from "../../../infrastructure/persistence/schema.js";
import { ConflictError } from "../../errors.js";
import { logger } from "../../../infrastructure/observability/logger.js";
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
  // Reap expired leases, verify no active lease, and claim in one transaction so
  // the read-then-write is atomic (Drizzle rolls back on any throw). A lost race
  // rolls back the reap too; the next acquire re-reaps — expired rows are inert.
  const expired = await db.transaction(async (tx) => {
    const expiredLeases = await tx
      .select()
      .from(conversationRunLeases)
      .where(and(eq(conversationRunLeases.conversationId, conversationId), lte(conversationRunLeases.expiresAt, now)));
    await tx
      .delete(conversationRunLeases)
      .where(and(eq(conversationRunLeases.conversationId, conversationId), lte(conversationRunLeases.expiresAt, now)));
    const [active] = await tx
      .select()
      .from(conversationRunLeases)
      .where(eq(conversationRunLeases.conversationId, conversationId));
    if (active) {
      throw new ConflictError("this conversation already has an active run", "active_run_exists", {
        run_id: active.runId,
      });
    }
    try {
      await tx.insert(conversationRunLeases).values({
        conversationId,
        runId,
        heartbeatAt: now,
        expiresAt: new Date(now.getTime() + LEASE_MS),
      });
    } catch {
      throw new ConflictError("this conversation already has an active run", "active_run_exists");
    }
    return expiredLeases;
  });
  // Cross-table run finalization for the leases we just reclaimed runs outside
  // the lease transaction — a slow/failed run update must not widen the window.
  await Promise.all(expired.map((lease) =>
    finishAgentRun({ runId: lease.runId, status: "interrupted" }).catch(() => undefined),
  ));
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
      logger.error({ err: error }, "run lease heartbeat failed"),
    );
  }, 60_000));
  cancellationPolls.set(runId, setInterval(() => {
    void getAgentRunById(runId)
      .then((run) => {
        if (run?.status === "cancel_requested") {
          controller.abort(new DOMException("agent run cancelled", "AbortError"));
        }
      })
      .catch((error) => logger.error({ err: error }, "cancellation poll failed"));
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
  const now = new Date();
  const orphaned = await listOrphanedRuns(now);
  if (orphaned.length === 0) return;
  const runIds = orphaned.map((run) => run.id);
  await interruptRuns(runIds);
  await Promise.all(
    orphaned.map((run) =>
      deactivateAgentStream(run.conversationId, run.id).catch((error) =>
        logger.error({ runId: run.id, err: error }, "failed to clear stream flag for orphaned run"),
      ),
    ),
  );
  await getDb().delete(conversationRunLeases).where(inArray(conversationRunLeases.runId, runIds));
  logger.info({ count: orphaned.length }, "reconciled orphaned runs");
}

const ORPHAN_RECONCILE_MS = 5 * 60_000;
let orphanReconcileTimer: ReturnType<typeof setInterval> | null = null;

export function startOrphanRunReconciler(): void {
  if (orphanReconcileTimer) return;
  orphanReconcileTimer = setInterval(() => {
    void reconcileOrphanedRuns().catch((error) =>
      logger.error({ err: error }, "periodic orphan run reconcile failed"),
    );
  }, ORPHAN_RECONCILE_MS);
  orphanReconcileTimer.unref();
}
