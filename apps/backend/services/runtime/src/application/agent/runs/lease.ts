import { setTimeout as delay } from "node:timers/promises";

import { and, desc, eq, gt, lte } from "drizzle-orm";

import { logger } from "../../../infrastructure/observability/logger.js";
import { getDb } from "../../../infrastructure/persistence/index.js";
import { threads, turnAttempts, turnLeases, turns } from "../../../infrastructure/persistence/schema.js";
import { ConflictError } from "../../errors.js";
import { deactivateAgentStream } from "../streams/service.js";
import {
  assertRunLease,
  claimOrphanedTurnRecovery,
  getAgentRunById,
  interruptRuns,
  listOrphanedRuns,
  requestAgentRunCancellation,
  RUN_LEASE_MS,
  type OrphanedTurnRecovery,
  type RunLeaseToken,
} from "./repository.js";
import { markSandboxExecutionsReleasing, reconcileSandboxExecutions } from "./sandbox-executions.js";

const controllers = new Map<
  string,
  {
    token: RunLeaseToken;
    controller: AbortController;
    heartbeat: ReturnType<typeof setInterval>;
    cancellationPoll: ReturnType<typeof setInterval>;
    completion: { promise: Promise<void>; resolve: () => void };
  }
>();
const CANCELLATION_POLL_MS = 1_000;
const CANCELLATION_WAIT_MS = 30_000;
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);

export async function acquireRunLease(sessionId: string, runId: string): Promise<RunLeaseToken> {
  const db = getDb();
  // Reap expired leases, verify no active lease, and claim in one transaction so
  // the read-then-write is atomic (Drizzle rolls back on any throw). A lost race
  // rolls back the reap too; the next acquire re-reaps — expired rows are inert.
  const claimed = await db.transaction(async (tx) => {
    await tx.select({ id: threads.id }).from(threads).where(eq(threads.id, sessionId)).for("update");
    const [run] = await tx.select().from(turns).where(eq(turns.id, runId)).for("update");
    if (!run || run.threadId !== sessionId || !["running", "cancel_requested"].includes(run.status)) {
      throw new ConflictError("agent run cannot acquire a lease", "run_lease_unavailable");
    }
    const now = new Date();
    const expiredLeases = await tx
      .select()
      .from(turnLeases)
      .where(and(eq(turnLeases.threadId, sessionId), lte(turnLeases.expiresAt, now)));
    await tx.delete(turnLeases).where(and(eq(turnLeases.threadId, sessionId), lte(turnLeases.expiresAt, now)));
    const [active] = await tx.select().from(turnLeases).where(eq(turnLeases.threadId, sessionId));
    if (active) {
      throw new ConflictError("this session already has an active run", "active_run_exists", {
        run_id: active.turnId,
      });
    }
    const [latestAttempt] = await tx
      .select()
      .from(turnAttempts)
      .where(eq(turnAttempts.turnId, runId))
      .orderBy(desc(turnAttempts.attemptEpoch))
      .limit(1);
    const attemptEpoch = latestAttempt ? latestAttempt.attemptEpoch + 1n : 1n;
    if (latestAttempt?.status === "running") {
      await tx
        .update(turnAttempts)
        .set({ status: "interrupted", error: "attempt lease expired", completedAt: now })
        .where(
          and(
            eq(turnAttempts.turnId, runId),
            eq(turnAttempts.attemptEpoch, latestAttempt.attemptEpoch),
            eq(turnAttempts.status, "running"),
          ),
        );
    }
    await tx.insert(turnAttempts).values({
      turnId: runId,
      attemptEpoch,
      threadId: sessionId,
      operation: latestAttempt ? "recovery" : "internal",
      targetItemId: latestAttempt?.targetItemId ?? null,
      historyItemId: latestAttempt?.historyItemId ?? null,
      historyRevision: latestAttempt?.historyRevision ?? null,
      status: "running",
      startedAt: now,
    });
    try {
      await tx.insert(turnLeases).values({
        threadId: sessionId,
        turnId: runId,
        attemptEpoch,
        heartbeatAt: now,
        expiresAt: new Date(now.getTime() + RUN_LEASE_MS),
      });
    } catch {
      throw new ConflictError("this session already has an active run", "active_run_exists");
    }
    return { expiredLeases, token: { runId, attemptEpoch } satisfies RunLeaseToken };
  });
  // Cross-table run finalization for the leases we just reclaimed runs outside
  // the lease transaction — a slow/failed run update must not widen the window.
  await interruptRuns(
    claimed.expiredLeases.filter((lease) => lease.turnId !== runId).map((lease) => lease.turnId),
  ).catch(() => []);
  return claimed.token;
}

export function registerRunController(token: RunLeaseToken): AbortSignal {
  const runId = token.runId;
  const previous = controllers.get(runId);
  if (previous?.token.attemptEpoch === token.attemptEpoch) return previous.controller.signal;
  if (previous && previous.token.attemptEpoch > token.attemptEpoch) {
    return AbortSignal.abort(new DOMException("agent run ownership was replaced", "AbortError"));
  }
  if (previous) {
    previous.completion.resolve();
    previous.controller.abort(new DOMException("agent run ownership was replaced", "AbortError"));
    clearInterval(previous.heartbeat);
    clearInterval(previous.cancellationPoll);
  }
  const controller = new AbortController();
  const loseOwnership = (error?: unknown) => {
    if (error) logger.error({ err: error, runId, attemptEpoch: token.attemptEpoch.toString() }, "run lease lost");
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("agent run ownership was lost", "AbortError"));
    }
  };
  const heartbeat = setInterval(() => {
    const now = new Date();
    void getDb()
      .update(turnLeases)
      .set({
        heartbeatAt: now,
        expiresAt: new Date(now.getTime() + RUN_LEASE_MS),
      })
      .where(
        and(
          eq(turnLeases.turnId, runId),
          eq(turnLeases.attemptEpoch, token.attemptEpoch),
          gt(turnLeases.expiresAt, now),
        ),
      )
      .returning({ runId: turnLeases.turnId })
      .then((rows) => {
        if (rows.length !== 1) loseOwnership();
      })
      .catch(loseOwnership);
  }, 60_000);
  const cancellationPoll = setInterval(() => {
    void Promise.all([assertRunLease(token), getAgentRunById(runId)])
      .then(([, run]) => {
        if (run?.status === "cancel_requested") {
          controller.abort(new DOMException("agent run cancelled", "AbortError"));
        }
      })
      .catch(loseOwnership);
  }, CANCELLATION_POLL_MS);
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  controllers.set(runId, { token, controller, heartbeat, cancellationPoll, completion: { promise, resolve } });
  return controller.signal;
}

export function abortRun(runId: string, reason: unknown): boolean {
  const controller = controllers.get(runId)?.controller;
  if (!controller || controller.signal.aborted) return false;
  controller.abort(reason);
  return true;
}

export async function releaseRun(token: RunLeaseToken): Promise<void> {
  const runId = token.runId;
  const active = controllers.get(runId);
  try {
    await getDb()
      .delete(turnLeases)
      .where(and(eq(turnLeases.turnId, runId), eq(turnLeases.attemptEpoch, token.attemptEpoch)));
  } finally {
    if (active?.token.attemptEpoch === token.attemptEpoch && controllers.get(runId) === active) {
      clearInterval(active.heartbeat);
      clearInterval(active.cancellationPoll);
      controllers.delete(runId);
      active.completion.resolve();
    }
  }
}

export async function cancelRun(sessionId: string, runId: string): Promise<boolean> {
  const run = await getAgentRunById(runId);
  if (!run || run.sessionId !== sessionId) {
    return false;
  }
  await requestAgentRunCancellation(runId);
  const deadline = Date.now() + CANCELLATION_WAIT_MS;
  while (Date.now() < deadline) {
    const active = controllers.get(runId);
    if (active) {
      active.controller.abort(new DOMException("agent run cancelled", "AbortError"));
      const remaining = deadline - Date.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          active.completion.promise,
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, remaining);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      continue;
    }
    const current = await getAgentRunById(runId);
    if (!current || TERMINAL_RUN_STATUSES.has(current.status)) return true;
    await delay(CANCELLATION_POLL_MS);
  }
  return false;
}

export type ClaimedTurnRecoveryRunner = (
  recovery: Extract<OrphanedTurnRecovery, { state: "claimed" }>,
) => Promise<void>;

interface OrphanRunReconcilerDependencies {
  reconcileSandboxes(): Promise<void>;
  deactivateStream(sessionId: string, runId: string): Promise<void>;
}

const orphanRunReconcilerDefaults: OrphanRunReconcilerDependencies = {
  reconcileSandboxes: reconcileSandboxExecutions,
  deactivateStream: deactivateAgentStream,
};

export async function reconcileOrphanedRuns(
  recoverClaimed: ClaimedTurnRecoveryRunner,
  deps: OrphanRunReconcilerDependencies = orphanRunReconcilerDefaults,
): Promise<void> {
  const now = new Date();
  const orphaned = await listOrphanedRuns(now);
  if (orphaned.length === 0) {
    return;
  }
  const outcomes = await Promise.all(
    orphaned.map(async (run) => ({ run, recovery: await claimOrphanedTurnRecovery(run.id, now) })),
  );
  const interrupted = outcomes.filter(
    (outcome): outcome is typeof outcome & { recovery: Extract<OrphanedTurnRecovery, { state: "interrupted" }> } =>
      outcome.recovery?.state === "interrupted",
  );
  const claimed = outcomes.flatMap((outcome) => (outcome.recovery?.state === "claimed" ? [outcome.recovery] : []));
  if (interrupted.length > 0) {
    await markSandboxExecutionsReleasing(interrupted.map(({ run }) => run.id));
  }
  if (interrupted.length > 0 || claimed.length > 0) {
    // Old-attempt sandboxes are finalized or released before a replacement host
    // starts. The new attempt lease makes the old writer mechanically obsolete.
    await deps.reconcileSandboxes();
  }
  await Promise.all(
    interrupted.map(({ run }) =>
      deps
        .deactivateStream(run.sessionId, run.id)
        .catch((error) => logger.error({ runId: run.id, err: error }, "failed to clear stream flag for orphaned run")),
    ),
  );
  for (const recovery of claimed) {
    void recoverClaimed(recovery).catch((error) =>
      logger.error(
        { err: error, runId: recovery.token.runId, attemptEpoch: recovery.token.attemptEpoch.toString() },
        "claimed Turn recovery failed",
      ),
    );
  }
  logger.info({ interrupted: interrupted.length, resumed: claimed.length }, "reconciled orphaned runs");
}

const ORPHAN_RECONCILE_MS = 5 * 60_000;
let orphanReconcileTimer: ReturnType<typeof setInterval> | null = null;

export function startOrphanRunReconciler(recoverClaimed: ClaimedTurnRecoveryRunner): void {
  if (orphanReconcileTimer) {
    return;
  }
  orphanReconcileTimer = setInterval(() => {
    void reconcileOrphanedRuns(recoverClaimed).catch((error) =>
      logger.error({ err: error }, "periodic orphan run reconcile failed"),
    );
  }, ORPHAN_RECONCILE_MS);
  orphanReconcileTimer.unref();
}
