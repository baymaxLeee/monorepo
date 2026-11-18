-- name: LockUploadState :one
SELECT state FROM upload_sessions WHERE id=sqlc.arg(id) FOR UPDATE;

-- name: UpsertBlob :one
INSERT INTO blobs
(id,tenant_id,sha256,size_bytes,storage_key,state,created_at)
VALUES (sqlc.arg(id),sqlc.arg(tenant_id),sqlc.arg(sha256),sqlc.arg(size_bytes),sqlc.arg(storage_key),'active',sqlc.arg(created_at))
ON CONFLICT (tenant_id,sha256,size_bytes) WHERE state='active'
DO UPDATE SET state=blobs.state
RETURNING id,storage_key;

-- name: CreateAsset :exec
INSERT INTO assets
(id,tenant_id,workspace_id,category,state,blocking_claim_count,state_version,created_by,created_at,updated_at)
VALUES (sqlc.arg(id),sqlc.arg(tenant_id),sqlc.arg(workspace_id),sqlc.arg(category),'active',1,1,sqlc.arg(created_by),sqlc.arg(created_at),sqlc.arg(created_at));

-- name: CreateFirstRevision :exec
INSERT INTO asset_revisions
(id,asset_id,blob_id,revision_number,filename,media_type,size_bytes,sha256,created_by,created_at)
VALUES (sqlc.arg(id),sqlc.arg(asset_id),sqlc.arg(blob_id),1,sqlc.arg(filename),sqlc.arg(media_type),sqlc.arg(size_bytes),sqlc.arg(sha256),sqlc.arg(created_by),sqlc.arg(created_at));

-- name: SetCurrentRevision :exec
UPDATE assets SET current_revision_id=sqlc.arg(current_revision_id) WHERE id=sqlc.arg(id);

-- name: CreateUploadLease :exec
INSERT INTO asset_claims
(id,tenant_id,workspace_id,owner_service,owner_type,owner_id,slot,asset_id,revision_id,kind,status,generation,expires_at,created_at,updated_at)
VALUES (sqlc.arg(id),sqlc.arg(tenant_id),sqlc.arg(workspace_id),'asset','upload_session',sqlc.arg(owner_id),'uploaded-bytes',sqlc.arg(asset_id),sqlc.arg(revision_id),'lease','active',1,sqlc.arg(expires_at),sqlc.arg(created_at),sqlc.arg(created_at));

-- name: LockAsset :one
SELECT id,tenant_id,workspace_id,category,state,COALESCE(current_revision_id::text,'')::text AS current_revision_id,
blocking_claim_count,state_version,created_by,created_at,updated_at
FROM assets WHERE id=sqlc.arg(id) AND tenant_id=sqlc.arg(tenant_id) AND workspace_id=sqlc.arg(workspace_id) FOR UPDATE;

-- name: LockAppendUpload :one
SELECT state,target_asset_id::text,base_revision_id::text,COALESCE(claim_owner_type,'') AS claim_owner_type,COALESCE(claim_owner_id,'') AS claim_owner_id,COALESCE(claim_slot,'') AS claim_slot,COALESCE(claim_generation,0)::bigint AS claim_generation
FROM upload_sessions WHERE id=sqlc.arg(id) FOR UPDATE;

-- name: NextRevisionNumber :one
SELECT (COALESCE(MAX(revision_number),0)+1)::bigint AS revision_number FROM asset_revisions WHERE asset_id=sqlc.arg(asset_id);

-- name: AppendRevision :exec
INSERT INTO asset_revisions
(id,asset_id,blob_id,revision_number,filename,media_type,size_bytes,sha256,created_by,created_at)
VALUES (sqlc.arg(id),sqlc.arg(asset_id),sqlc.arg(blob_id),sqlc.arg(revision_number),sqlc.arg(filename),sqlc.arg(media_type),sqlc.arg(size_bytes),sqlc.arg(sha256),sqlc.arg(created_by),sqlc.arg(created_at));

-- name: AdvanceRevision :one
UPDATE assets SET current_revision_id=sqlc.arg(current_revision_id),state='active',candidate_at=NULL,delete_after=NULL,
blocking_claim_count=blocking_claim_count+1,state_version=state_version+1,updated_at=sqlc.arg(updated_at) WHERE id=sqlc.arg(id)
RETURNING state,blocking_claim_count,state_version,updated_at;

-- name: GetRevision :one
SELECT a.id,a.tenant_id,a.workspace_id,a.category,a.state,COALESCE(a.current_revision_id::text,'')::text AS current_revision_id,a.blocking_claim_count,a.state_version,a.created_by,a.created_at,a.updated_at,
r.id AS revision_id,r.blob_id,r.revision_number,r.filename,r.media_type,r.size_bytes,r.sha256,r.created_by AS revision_creator,r.created_at AS revision_created_at,b.storage_key
FROM assets a JOIN asset_revisions r ON r.asset_id=a.id JOIN blobs b ON b.id=r.blob_id
WHERE a.id=sqlc.arg(asset_id) AND r.id=sqlc.arg(revision_id) AND a.tenant_id=sqlc.arg(tenant_id) AND a.workspace_id=sqlc.arg(workspace_id) AND a.state IN ('active','candidate') AND b.state='active';
