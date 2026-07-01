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

// Stop aborts the model/tool-loop turn. write_file/edit_file now foreground-
// block on their executor task (ADR-0015 revision), so aborting the turn also
// aborts the tool's abortSignal, and the tool itself calls the executor's
// cancel endpoint before unwinding — the in-flight artifact generation is
// abandoned with the turn, matching how Cursor's file write stops when you hit
// Stop. There is no orphaned background task to reach into afterwards.
export async function cancelRun(conversationId: string, runId: string): Promise<boolean> {
  const run = await getAgentRunById(runId);
  if (!run || run.conversationId !== conversationId) return false;
  await requestAgentRunCancellation(runId);
  controllers.get(runId)?.abort(new DOMException("agent run cancelled", "AbortError"));
  return true;
}

// Boot-time cleanup for runs orphaned by a process crash/restart mid-stream.
// A fresh process starts with empty `controllers`/`heartbeats` maps, so any
// run still `running`/`cancel_requested` in MySQL is unrecoverable — its
// heartbeat stopped renewing `conversation_run_leases` the moment the old
// process died, but nothing else ever notices on its own:
// - The Redis "active" flag (agent/streams/service.ts) is only cleared by the
//   dead process's own `finally` block, so it keeps telling
//   `GET /:conversationId/agents/run/stream` the run is still generating for
//   up to an hour (its TTL is scoped for legitimate reconnect gaps, not
//   liveness) — every refresh just reattaches to the same stuck belief.
// - `conversation_run_leases` rows are only reaped lazily, inside
//   `acquireRunLease`, the next time that conversation tries to start a run.
// Call this once, before the server starts accepting traffic, so neither gap
// can strand a conversation in "generating" indefinitely.
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
  // Every lease's heartbeat setInterval died with the old process, so none of
  // them can still be legitimate — drop them now instead of waiting for each
  // row's individual expiresAt.
  await getDb().delete(conversationRunLeases);
  console.info(`[chat-agent] reconciled ${orphaned.length} orphaned run(s) on boot`);
}
