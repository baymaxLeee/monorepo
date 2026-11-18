-- name: MarkCandidates :execrows
WITH candidates AS (
SELECT a.id FROM assets a WHERE a.state='active' AND a.blocking_claim_count=0 AND a.updated_at <= sqlc.arg(updated_at)
AND NOT EXISTS (SELECT 1 FROM asset_claims c WHERE c.asset_id=a.id AND c.status IN ('pending','active') AND c.kind IN ('strong','snapshot','lease'))
ORDER BY a.updated_at,a.id FOR UPDATE SKIP LOCKED LIMIT sqlc.arg(batch_size)
) UPDATE assets a SET state='candidate',candidate_at=sqlc.arg(candidate_at),delete_after=sqlc.arg(delete_after),state_version=state_version+1,updated_at=sqlc.arg(candidate_at)
FROM candidates c WHERE a.id=c.id;

-- name: LockDeletionCandidates :many
SELECT a.id,a.tenant_id,a.state_version FROM assets a
WHERE ((a.state='candidate' AND a.delete_after <= sqlc.arg(delete_after)) OR (a.state='deleting' AND a.delete_after <= sqlc.arg(delete_after)))
AND NOT EXISTS (SELECT 1 FROM asset_claims c WHERE c.asset_id=a.id AND c.status IN ('pending','active') AND c.kind IN ('strong','snapshot','lease'))
ORDER BY a.delete_after,a.id FOR UPDATE SKIP LOCKED LIMIT sqlc.arg(batch_size);

-- name: StartDeletion :execrows
UPDATE assets SET state='deleting',delete_after=sqlc.arg(delete_after),state_version=state_version+1,updated_at=sqlc.arg(updated_at)
WHERE id=sqlc.arg(id) AND state_version=sqlc.arg(state_version) AND state IN ('candidate','deleting');

-- name: LockAssetBlobs :many
SELECT b.id,b.storage_key,b.state,COALESCE(b.deletion_owner_asset_id::text,'')::text AS deletion_owner_asset_id
FROM blobs b WHERE EXISTS (
SELECT 1 FROM asset_revisions r WHERE r.blob_id=b.id AND r.asset_id=sqlc.arg(asset_id)
) ORDER BY b.id FOR UPDATE OF b;

-- name: HasReadableReference :one
SELECT EXISTS(SELECT 1 FROM asset_revisions r JOIN assets a ON a.id=r.asset_id
WHERE r.blob_id=sqlc.arg(blob_id) AND a.state NOT IN ('deleting','deleted'));

-- name: StartBlobDeletion :execrows
UPDATE blobs SET state='deleting',deleting_at=sqlc.arg(deleting_at),deletion_owner_asset_id=sqlc.arg(deletion_owner_asset_id),state_version=state_version+1 WHERE id=sqlc.arg(id) AND state='active';

-- name: CompleteDeletion :execrows
UPDATE assets SET state='deleted',state_version=state_version+1,updated_at=sqlc.arg(updated_at),last_error_code=NULL
WHERE assets.id=sqlc.arg(id) AND state_version=sqlc.arg(state_version) AND state='deleting'
AND NOT EXISTS (SELECT 1 FROM asset_claims WHERE asset_id=sqlc.arg(id) AND status IN ('pending','active') AND kind IN ('strong','snapshot','lease'));

-- name: CompleteBlobDeletion :exec
UPDATE blobs SET state='deleted',deleted_at=sqlc.arg(deleted_at),deletion_owner_asset_id=NULL,state_version=state_version+1
WHERE id=sqlc.arg(id) AND deletion_owner_asset_id=sqlc.arg(deletion_owner_asset_id) AND state='deleting';

-- name: RetryDeletion :execrows
UPDATE assets SET state='deleting',
delete_after=sqlc.arg(updated_at)::pg_catalog.timestamptz + make_interval(secs => LEAST(3600, (power(2, LEAST(deletion_attempts, 10)) * 15)::int)),
deletion_attempts=deletion_attempts+1,last_error_code=sqlc.arg(last_error_code),state_version=state_version+1,updated_at=sqlc.arg(updated_at)
WHERE id=sqlc.arg(id) AND state_version=sqlc.arg(state_version) AND state='deleting';
