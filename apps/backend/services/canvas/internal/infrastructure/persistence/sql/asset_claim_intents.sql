-- name: InsertClaimIntent :execrows
INSERT INTO asset_claim_intents (
    tenant_id, workspace_id, owner_type, owner_id, slot, asset_id, revision_id, kind,
    generation, desired_state, expires_at, next_attempt_at, state_version, attempts, last_error, created_at, updated_at
) VALUES (
    @tenant_id, @workspace_id, @owner_type, @owner_id, @slot, @asset_id, @revision_id, @kind,
    @generation, @desired_state, @expires_at, @now::pg_catalog.timestamptz, 1, 0, '', @now, @now
) ON CONFLICT (tenant_id, workspace_id, owner_type, owner_id, slot) DO NOTHING;

-- name: LockClaimIntent :one
SELECT * FROM asset_claim_intents
WHERE tenant_id = @tenant_id AND workspace_id = @workspace_id AND owner_type = @owner_type AND owner_id = @owner_id AND slot = @slot
FOR UPDATE;

-- name: ReplaceClaimIntent :exec
UPDATE asset_claim_intents
SET asset_id = @asset_id, revision_id = @revision_id, kind = @kind, generation = @generation, desired_state = @desired_state,
    expires_at = @expires_at, delivered_at = NULL, next_attempt_at = @now::pg_catalog.timestamptz, lease_until = NULL,
    state_version = state_version + 1, attempts = 0, last_error = '', updated_at = @now
WHERE tenant_id = @tenant_id AND workspace_id = @workspace_id AND owner_type = @owner_type AND owner_id = @owner_id AND slot = @slot;

-- name: ClaimDueAssetIntents :many
WITH due AS (
    SELECT tenant_id, workspace_id, owner_type, owner_id, slot FROM asset_claim_intents
    WHERE delivered_at IS NULL AND next_attempt_at <= @now::pg_catalog.timestamptz
      AND (lease_until IS NULL OR lease_until <= @now)
    ORDER BY next_attempt_at, updated_at, tenant_id, workspace_id, owner_type, owner_id, slot
    LIMIT @page_size::bigint FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE asset_claim_intents i SET lease_until = @lease::pg_catalog.timestamptz, state_version = i.state_version + 1
    FROM due
    WHERE (i.tenant_id,i.workspace_id,i.owner_type,i.owner_id,i.slot) = (due.tenant_id,due.workspace_id,due.owner_type,due.owner_id,due.slot)
    RETURNING i.*
)
SELECT * FROM claimed ORDER BY next_attempt_at, updated_at, tenant_id, workspace_id, owner_type, owner_id, slot;

-- name: DeliverClaimIntent :execrows
UPDATE asset_claim_intents
SET delivered_at = @now::pg_catalog.timestamptz, lease_until = NULL, state_version = state_version + 1, last_error = '', updated_at = @now
WHERE tenant_id = @tenant_id AND workspace_id = @workspace_id AND owner_type = @owner_type AND owner_id = @owner_id AND slot = @slot
  AND generation = @generation AND desired_state = @desired_state AND state_version = @state_version
  AND delivered_at IS NULL AND lease_until > @now;

-- name: RetryClaimIntent :execrows
UPDATE asset_claim_intents
SET next_attempt_at = @next_attempt_at, lease_until = NULL, state_version = state_version + 1, attempts = attempts + 1, last_error = @message, updated_at = @now
WHERE tenant_id = @tenant_id AND workspace_id = @workspace_id AND owner_type = @owner_type AND owner_id = @owner_id AND slot = @slot
  AND generation = @generation AND desired_state = @desired_state AND state_version = @state_version
  AND delivered_at IS NULL AND lease_until > @now;
