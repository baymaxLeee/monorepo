-- name: LockClaimSlot :exec
SELECT pg_advisory_xact_lock(hashtextextended(concat_ws(E'\x1f',sqlc.arg(tenant_id)::text,sqlc.arg(workspace_id)::text,sqlc.arg(owner_service)::text,sqlc.arg(owner_type)::text,sqlc.arg(owner_id)::text,sqlc.arg(slot)::text),0));

-- name: LockExistingClaim :one
SELECT id,asset_id,COALESCE(revision_id::text,'')::text AS revision_id,kind,status,generation,expires_at FROM asset_claims
WHERE tenant_id=sqlc.arg(tenant_id) AND workspace_id=sqlc.arg(workspace_id) AND owner_service=sqlc.arg(owner_service) AND owner_type=sqlc.arg(owner_type) AND owner_id=sqlc.arg(owner_id) AND slot=sqlc.arg(slot) FOR UPDATE;

-- name: LockClaimAssets :many
SELECT id::text,state FROM assets
WHERE (id=sqlc.arg(asset_id) OR id=NULLIF(sqlc.arg(previous_asset_id)::text,'')::uuid) AND tenant_id=sqlc.arg(tenant_id) AND workspace_id=sqlc.arg(workspace_id)
ORDER BY id FOR UPDATE;

-- name: RevisionExists :one
SELECT EXISTS(SELECT 1 FROM asset_revisions WHERE id=sqlc.arg(id) AND asset_id=sqlc.arg(asset_id));

-- name: UpsertClaim :exec
INSERT INTO asset_claims
(id,tenant_id,workspace_id,owner_service,owner_type,owner_id,slot,asset_id,revision_id,kind,status,generation,expires_at,created_at,updated_at)
VALUES (sqlc.arg(id),sqlc.arg(tenant_id),sqlc.arg(workspace_id),sqlc.arg(owner_service),sqlc.arg(owner_type),sqlc.arg(owner_id),sqlc.arg(slot),sqlc.arg(asset_id),NULLIF(sqlc.arg(revision_id)::text,'')::uuid,sqlc.arg(kind),'pending',sqlc.arg(generation),sqlc.arg(expires_at),sqlc.arg(created_at),sqlc.arg(created_at))
ON CONFLICT (tenant_id,workspace_id,owner_service,owner_type,owner_id,slot) DO UPDATE SET
asset_id=EXCLUDED.asset_id,revision_id=EXCLUDED.revision_id,kind=EXCLUDED.kind,status='pending',generation=EXCLUDED.generation,expires_at=EXCLUDED.expires_at,updated_at=EXCLUDED.updated_at,released_at=NULL;

-- name: DecrementBlockingClaims :exec
UPDATE assets SET blocking_claim_count=blocking_claim_count-1,state_version=state_version+1,updated_at=sqlc.arg(updated_at) WHERE id=sqlc.arg(id);

-- name: ApplyClaimDelta :exec
UPDATE assets SET blocking_claim_count=blocking_claim_count+sqlc.arg(blocking_delta),
state=CASE WHEN sqlc.arg(reactivate)::boolean THEN 'active' ELSE state END,candidate_at=CASE WHEN sqlc.arg(reactivate)::boolean THEN NULL ELSE candidate_at END,
delete_after=CASE WHEN sqlc.arg(reactivate)::boolean THEN NULL ELSE delete_after END,state_version=state_version+1,updated_at=sqlc.arg(updated_at) WHERE id=sqlc.arg(id);

-- name: LockClaim :one
SELECT id,tenant_id,workspace_id,owner_service,owner_type,owner_id,slot,asset_id,COALESCE(revision_id::text,'')::text AS revision_id,kind,status,generation,expires_at FROM asset_claims
WHERE tenant_id=sqlc.arg(tenant_id) AND workspace_id=sqlc.arg(workspace_id) AND owner_service=sqlc.arg(owner_service) AND owner_type=sqlc.arg(owner_type) AND owner_id=sqlc.arg(owner_id) AND slot=sqlc.arg(slot) FOR UPDATE;

-- name: SetClaimStatus :exec
UPDATE asset_claims SET status=sqlc.arg(status)::varchar,updated_at=sqlc.arg(updated_at)::pg_catalog.timestamptz,released_at=CASE WHEN sqlc.arg(status)::text='released' THEN sqlc.arg(updated_at)::pg_catalog.timestamptz ELSE NULL::pg_catalog.timestamptz END WHERE id=sqlc.arg(id);

-- name: UpdateClaimCount :exec
UPDATE assets SET blocking_claim_count=blocking_claim_count+sqlc.arg(blocking_delta),state_version=state_version+1,updated_at=sqlc.arg(updated_at) WHERE id=sqlc.arg(id);

-- name: LockExpiredLeases :many
SELECT id,asset_id FROM asset_claims WHERE kind='lease' AND status IN ('pending','active') AND expires_at <= sqlc.arg(expires_at) ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT sqlc.arg(batch_size);

-- name: ReleaseExpiredLease :exec
UPDATE asset_claims SET status='released',released_at=sqlc.arg(released_at),updated_at=sqlc.arg(released_at) WHERE id=sqlc.arg(id);

-- name: ReconcileClaimCounts :execrows
WITH drifted AS (
SELECT a.id, (SELECT count(*)::bigint FROM asset_claims c WHERE c.asset_id=a.id
AND c.status IN ('pending','active') AND c.kind IN ('strong','snapshot','lease')) AS actual_count
FROM assets a
WHERE a.state NOT IN ('deleted','quarantined')
AND a.blocking_claim_count <> (SELECT count(*)::bigint FROM asset_claims c WHERE c.asset_id=a.id
AND c.status IN ('pending','active') AND c.kind IN ('strong','snapshot','lease'))
ORDER BY a.id FOR UPDATE OF a SKIP LOCKED LIMIT sqlc.arg(batch_size)
) UPDATE assets a SET
blocking_claim_count=d.actual_count,
state=CASE WHEN d.actual_count > 0 AND a.state='candidate' THEN 'active' ELSE a.state END,
candidate_at=CASE WHEN d.actual_count > 0 AND a.state='candidate' THEN NULL ELSE a.candidate_at END,
delete_after=CASE WHEN d.actual_count > 0 AND a.state='candidate' THEN NULL ELSE a.delete_after END,
state_version=a.state_version+1,updated_at=sqlc.arg(updated_at)
FROM drifted d WHERE a.id=d.id;
