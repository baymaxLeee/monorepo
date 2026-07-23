import { cleanupConversationArtifacts } from "../infrastructure/clients/knowledge.js";
import { logger } from "../infrastructure/observability/logger.js";
import { getSql } from "../infrastructure/persistence/index.js";

interface CleanupClaim {
  conversation_id: string;
  user_id: string;
  org_id: string;
  attempts: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

async function claimNextCleanup(): Promise<CleanupClaim | undefined> {
  const [row] = await getSql()<CleanupClaim[]>`
    WITH candidate AS (
      SELECT conversation_id
      FROM conversation_artifact_cleanup_outbox
      WHERE available_at <= NOW()
        AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '1 minute')
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE conversation_artifact_cleanup_outbox AS outbox
    SET claimed_at = NOW(), attempts = outbox.attempts + 1
    FROM candidate
    WHERE outbox.conversation_id = candidate.conversation_id
    RETURNING outbox.conversation_id, outbox.user_id, outbox.org_id, outbox.attempts
  `;
  return row;
}

async function deliverCleanup(claim: CleanupClaim): Promise<void> {
  try {
    await cleanupConversationArtifacts({
      conversationId: claim.conversation_id,
      userId: claim.user_id,
      orgId: claim.org_id,
    });
    await getSql()`
      DELETE FROM conversation_artifact_cleanup_outbox
      WHERE conversation_id = ${claim.conversation_id}
    `;
    logger.info(
      { conversationId: claim.conversation_id, attempts: claim.attempts },
      "conversation artifact cleanup delivered",
    );
  } catch (error) {
    const backoffSeconds = Math.min(300, 2 ** Math.min(claim.attempts, 8));
    const nextAttempt = new Date(Date.now() + backoffSeconds * 1000);
    await getSql()`
      UPDATE conversation_artifact_cleanup_outbox
      SET claimed_at = NULL,
          available_at = ${nextAttempt},
          last_error = ${errorMessage(error).slice(0, 2000)}
      WHERE conversation_id = ${claim.conversation_id}
    `;
    logger.warn(
      { conversationId: claim.conversation_id, attempts: claim.attempts, err: error },
      "conversation artifact cleanup delivery failed",
    );
  }
}

let draining = false;

export async function drainConversationArtifactCleanups(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (true) {
      const claim = await claimNextCleanup();
      if (!claim) return;
      await deliverCleanup(claim);
    }
  } finally {
    draining = false;
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startConversationArtifactCleanupRelay(): void {
  if (cleanupTimer) return;
  void drainConversationArtifactCleanups().catch((error) =>
    logger.error({ err: error }, "initial conversation artifact cleanup drain failed"),
  );
  cleanupTimer = setInterval(() => {
    void drainConversationArtifactCleanups().catch((error) =>
      logger.error({ err: error }, "conversation artifact cleanup drain failed"),
    );
  }, 5000);
  cleanupTimer.unref();
}

