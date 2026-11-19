import { cleanupSessionArtifacts } from "../infrastructure/clients/knowledge.js";
import { logger } from "../infrastructure/observability/logger.js";
import { getSql } from "../infrastructure/persistence/index.js";

interface CleanupClaim {
  thread_id: string;
  user_id: string;
  tenant_id: string;
  workspace_id: string;
  attempts: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

async function claimNextCleanup(): Promise<CleanupClaim | undefined> {
  const [row] = await getSql()<CleanupClaim[]>`
    WITH candidate AS (
      SELECT thread_id
      FROM thread_artifact_cleanup_outbox
      WHERE available_at <= NOW()
        AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '1 minute')
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE thread_artifact_cleanup_outbox AS outbox
    SET claimed_at = NOW(), attempts = outbox.attempts + 1
    FROM candidate
    WHERE outbox.thread_id = candidate.thread_id
    RETURNING outbox.thread_id, outbox.user_id, outbox.tenant_id, outbox.workspace_id, outbox.attempts
  `;
  return row;
}

async function deliverCleanup(claim: CleanupClaim): Promise<void> {
  try {
    await cleanupSessionArtifacts({
      sessionId: claim.thread_id,
      userId: claim.user_id,
      tenantId: claim.tenant_id,
      workspaceId: claim.workspace_id,
    });
    await getSql()`
      DELETE FROM thread_artifact_cleanup_outbox
      WHERE thread_id = ${claim.thread_id}
    `;
    logger.info({ threadId: claim.thread_id, attempts: claim.attempts }, "Thread artifact cleanup delivered");
  } catch (error) {
    const backoffSeconds = Math.min(300, 2 ** Math.min(claim.attempts, 8));
    const nextAttempt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
    await getSql()`
      UPDATE thread_artifact_cleanup_outbox
      SET claimed_at = NULL,
          available_at = ${nextAttempt},
          last_error = ${errorMessage(error).slice(0, 2000)}
      WHERE thread_id = ${claim.thread_id}
    `;
    logger.warn(
      { threadId: claim.thread_id, attempts: claim.attempts, err: error },
      "Thread artifact cleanup delivery failed",
    );
  }
}

let draining = false;

export async function drainSessionArtifactCleanups(): Promise<void> {
  if (draining) {
    return;
  }
  draining = true;
  try {
    while (true) {
      const claim = await claimNextCleanup();
      if (!claim) {
        return;
      }
      await deliverCleanup(claim);
    }
  } finally {
    draining = false;
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startSessionArtifactCleanupRelay(): void {
  if (cleanupTimer) {
    return;
  }
  void drainSessionArtifactCleanups().catch((error) =>
    logger.error({ err: error }, "initial session artifact cleanup drain failed"),
  );
  cleanupTimer = setInterval(() => {
    void drainSessionArtifactCleanups().catch((error) =>
      logger.error({ err: error }, "session artifact cleanup drain failed"),
    );
  }, 5000);
  cleanupTimer.unref();
}
