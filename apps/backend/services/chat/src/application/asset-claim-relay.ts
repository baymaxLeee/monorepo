import { storageClient } from "../infrastructure/clients/storage.js";
import { logger } from "../infrastructure/observability/logger.js";
import { getSql } from "../infrastructure/persistence/index.js";

interface ClaimIntentRow {
  tenant_id: string;
  workspace_id: string;
  owner_type: string;
  owner_id: string;
  slot: string;
  asset_id: string;
  revision_id: string | null;
  kind: "strong" | "snapshot" | "lease" | "weak";
  generation: string;
  desired_state: "active" | "released";
  attempt_count: number;
  state_version: string;
}

interface ClaimIntent extends Omit<ClaimIntentRow, "generation"> {
  generation: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

async function claimNext(): Promise<ClaimIntent | undefined> {
  const [row] = await getSql()<ClaimIntentRow[]>`
    WITH candidate AS (
      SELECT tenant_id, workspace_id, owner_type, owner_id, slot
      FROM asset_claim_intents
      WHERE delivered_at IS NULL
        AND next_attempt_at <= NOW()
        AND (lease_until IS NULL OR lease_until <= NOW())
      ORDER BY next_attempt_at, updated_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE asset_claim_intents AS intent
    SET lease_until = NOW() + INTERVAL '1 minute'
    FROM candidate
    WHERE intent.tenant_id = candidate.tenant_id
      AND intent.workspace_id = candidate.workspace_id
      AND intent.owner_type = candidate.owner_type
      AND intent.owner_id = candidate.owner_id
      AND intent.slot = candidate.slot
    RETURNING intent.tenant_id, intent.workspace_id, intent.owner_type, intent.owner_id, intent.slot,
      intent.asset_id, intent.revision_id, intent.kind, intent.generation, intent.desired_state,
      intent.attempt_count, intent.state_version
  `;
  if (!row) return undefined;
  const generation = Number(row.generation);
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new Error(`invalid asset claim generation ${JSON.stringify(row.generation)}`);
  }
  return { ...row, generation };
}

async function deliver(intent: ClaimIntent): Promise<void> {
  const identity = {
    tenantId: intent.tenant_id,
    workspaceId: intent.workspace_id,
    ownerType: intent.owner_type,
    ownerId: intent.owner_id,
    slot: intent.slot,
    generation: intent.generation,
  };
  try {
    if (!intent.revision_id) throw new Error("conversation file claim has no revision");
    await storageClient().prepareClaim({
      ...identity,
      assetId: intent.asset_id,
      revisionId: intent.revision_id,
      kind: intent.kind,
    });
    if (intent.desired_state === "released") {
      await storageClient().releaseClaim(identity);
    } else {
      await storageClient().activateClaim(identity);
    }
    await getSql()`
      UPDATE asset_claim_intents
      SET delivered_at = NOW(), lease_until = NULL, last_error = NULL, updated_at = NOW()
      WHERE tenant_id = ${intent.tenant_id}
        AND workspace_id = ${intent.workspace_id}
        AND owner_type = ${intent.owner_type}
        AND owner_id = ${intent.owner_id}
        AND slot = ${intent.slot}
        AND generation = ${intent.generation}
        AND state_version = ${intent.state_version}
        AND desired_state = ${intent.desired_state}
    `;
  } catch (error) {
    const attempt = intent.attempt_count + 1;
    const nextAttempt = new Date(Date.now() + Math.min(300, 2 ** Math.min(attempt, 8)) * 1000).toISOString();
    await getSql()`
      UPDATE asset_claim_intents
      SET attempt_count = ${attempt}, next_attempt_at = ${nextAttempt}, lease_until = NULL,
          last_error = ${errorMessage(error).slice(0, 2000)}, updated_at = NOW()
      WHERE tenant_id = ${intent.tenant_id}
        AND workspace_id = ${intent.workspace_id}
        AND owner_type = ${intent.owner_type}
        AND owner_id = ${intent.owner_id}
        AND slot = ${intent.slot}
        AND generation = ${intent.generation}
        AND state_version = ${intent.state_version}
        AND desired_state = ${intent.desired_state}
    `;
    logger.warn({ err: error, ownerType: intent.owner_type, ownerId: intent.owner_id }, "asset claim delivery failed");
  }
}

let draining = false;

export async function drainAssetClaimIntents(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (true) {
      const intent = await claimNext();
      if (!intent) return;
      await deliver(intent);
    }
  } finally {
    draining = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startAssetClaimRelay(): void {
  if (timer) return;
  void drainAssetClaimIntents().catch((error) => logger.error({ err: error }, "initial asset claim drain failed"));
  timer = setInterval(() => {
    void drainAssetClaimIntents().catch((error) => logger.error({ err: error }, "asset claim drain failed"));
  }, 5000);
  timer.unref();
}
