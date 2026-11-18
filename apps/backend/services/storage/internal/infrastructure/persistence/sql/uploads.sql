-- name: InsertUpload :one
INSERT INTO upload_sessions
(id,tenant_id,workspace_id,user_id,caller_service,idempotency_key,category,filename,declared_media_type,state,expires_at,created_at,updated_at)
VALUES (sqlc.arg(id),sqlc.arg(tenant_id),sqlc.arg(workspace_id),sqlc.arg(user_id),sqlc.arg(caller_service),NULLIF(sqlc.arg(idempotency_key)::text,''),sqlc.arg(category),sqlc.arg(filename),sqlc.arg(declared_media_type),'uploading',sqlc.arg(expires_at),sqlc.arg(created_at),sqlc.arg(created_at))
ON CONFLICT DO NOTHING RETURNING id;

-- name: LockExistingUpload :one
SELECT id,user_id,category,filename,declared_media_type,state,COALESCE(asset_id::text,'')::text AS asset_id,COALESCE(revision_id::text,'')::text AS revision_id
FROM upload_sessions
WHERE tenant_id=sqlc.arg(tenant_id) AND workspace_id=sqlc.arg(workspace_id) AND caller_service=sqlc.arg(caller_service) AND idempotency_key=sqlc.arg(idempotency_key)
FOR UPDATE;

-- name: RestartUpload :exec
UPDATE upload_sessions
SET state='uploading',error_code=NULL,expires_at=sqlc.arg(expires_at),updated_at=sqlc.arg(updated_at) WHERE id=sqlc.arg(id);

-- name: InsertAppendUpload :one
INSERT INTO upload_sessions
(id,tenant_id,workspace_id,user_id,caller_service,idempotency_key,category,filename,declared_media_type,
state,expires_at,created_at,updated_at,target_asset_id,base_revision_id,claim_owner_type,claim_owner_id,claim_slot,claim_generation)
VALUES (sqlc.arg(id),sqlc.arg(tenant_id),sqlc.arg(workspace_id),sqlc.arg(user_id),sqlc.arg(caller_service),sqlc.arg(idempotency_key),'revision-append',sqlc.arg(filename),sqlc.arg(declared_media_type),'uploading',sqlc.arg(expires_at),sqlc.arg(created_at),sqlc.arg(created_at),sqlc.arg(target_asset_id),sqlc.arg(base_revision_id),sqlc.arg(claim_owner_type),sqlc.arg(claim_owner_id),sqlc.arg(claim_slot),sqlc.arg(claim_generation))
ON CONFLICT DO NOTHING RETURNING id;

-- name: LockExistingAppend :one
SELECT id,user_id,filename,declared_media_type,state,COALESCE(target_asset_id::text,'')::text AS target_asset_id,COALESCE(base_revision_id::text,'')::text AS base_revision_id,
COALESCE(claim_owner_type,'') AS claim_owner_type,COALESCE(claim_owner_id,'') AS claim_owner_id,COALESCE(claim_slot,'') AS claim_slot,COALESCE(claim_generation,0)::bigint AS claim_generation,COALESCE(asset_id::text,'')::text AS asset_id,COALESCE(revision_id::text,'')::text AS revision_id,expires_at
FROM upload_sessions
WHERE tenant_id=sqlc.arg(tenant_id) AND workspace_id=sqlc.arg(workspace_id) AND caller_service=sqlc.arg(caller_service) AND idempotency_key=sqlc.arg(idempotency_key) FOR UPDATE;

-- name: RetireUpload :exec
UPDATE upload_sessions SET state='aborted',idempotency_key='retired:' || id::text,expires_at=sqlc.arg(expires_at),updated_at=sqlc.arg(expires_at) WHERE id=sqlc.arg(id);

-- name: ReplaceAppendUpload :exec
INSERT INTO upload_sessions
(id,tenant_id,workspace_id,user_id,caller_service,idempotency_key,category,filename,declared_media_type,
state,expires_at,created_at,updated_at,target_asset_id,base_revision_id,claim_owner_type,claim_owner_id,claim_slot,claim_generation)
SELECT sqlc.arg(upload_id)::uuid,tenant_id,workspace_id,user_id,caller_service,sqlc.arg(idempotency_key)::varchar,category,filename,declared_media_type,
'uploading',sqlc.arg(expires_at)::pg_catalog.timestamptz,sqlc.arg(updated_at)::pg_catalog.timestamptz,sqlc.arg(updated_at),target_asset_id,base_revision_id,claim_owner_type,claim_owner_id,claim_slot,claim_generation
FROM upload_sessions AS old WHERE old.id=sqlc.arg(previous_upload_id);

-- name: CheckAppendAuthorization :one
SELECT a.state,
EXISTS(SELECT 1 FROM asset_revisions r WHERE r.id=sqlc.arg(base_revision_id) AND r.asset_id=a.id) AS base_exists,
EXISTS(SELECT 1 FROM asset_claims c
WHERE c.tenant_id=sqlc.arg(tenant_id) AND c.workspace_id=sqlc.arg(workspace_id) AND c.owner_service=sqlc.arg(owner_service) AND c.owner_type=sqlc.arg(owner_type)
AND c.owner_id=sqlc.arg(owner_id) AND c.slot=sqlc.arg(slot) AND c.generation=sqlc.arg(generation) AND c.asset_id=a.id
AND c.revision_id=sqlc.arg(base_revision_id) AND c.kind='strong' AND c.status IN ('pending','active')) AS claim_exists
FROM assets a WHERE a.id=sqlc.arg(asset_id) AND a.tenant_id=sqlc.arg(tenant_id) AND a.workspace_id=sqlc.arg(workspace_id);

-- name: InsertPendingUpload :one
INSERT INTO upload_sessions
(id,tenant_id,workspace_id,user_id,caller_service,idempotency_key,category,filename,declared_media_type,declared_size_bytes,state,expires_at,created_at,updated_at)
VALUES (sqlc.arg(id),sqlc.arg(tenant_id),sqlc.arg(workspace_id),sqlc.arg(user_id),sqlc.arg(caller_service),sqlc.arg(idempotency_key),sqlc.arg(category),sqlc.arg(filename),sqlc.arg(declared_media_type),sqlc.arg(declared_size_bytes),'pending',sqlc.arg(expires_at),sqlc.arg(created_at),sqlc.arg(created_at))
ON CONFLICT DO NOTHING RETURNING id;

-- name: LockScopedUpload :one
SELECT id,tenant_id,workspace_id,user_id,caller_service,COALESCE(idempotency_key,'')::text AS idempotency_key,
category,filename,declared_media_type,COALESCE(declared_size_bytes,-1)::bigint AS size_bytes,state,
COALESCE(asset_id::text,'')::text AS asset_id,COALESCE(revision_id::text,'')::text AS revision_id,expires_at
FROM upload_sessions
WHERE tenant_id=sqlc.arg(tenant_id) AND workspace_id=sqlc.arg(workspace_id) AND caller_service=sqlc.arg(caller_service) AND idempotency_key=sqlc.arg(idempotency_key)
FOR UPDATE;

-- name: LockUpload :one
SELECT id,tenant_id,workspace_id,user_id,caller_service,COALESCE(idempotency_key,'')::text AS idempotency_key,
category,filename,declared_media_type,COALESCE(declared_size_bytes,-1)::bigint AS size_bytes,state,
COALESCE(asset_id::text,'')::text AS asset_id,COALESCE(revision_id::text,'')::text AS revision_id,expires_at
FROM upload_sessions WHERE id=sqlc.arg(id) FOR UPDATE;

-- name: AbortExpiredUpload :exec
UPDATE upload_sessions SET state='aborted',error_code='upload_expired',updated_at=sqlc.arg(updated_at) WHERE id=sqlc.arg(id);

-- name: StartUpload :exec
UPDATE upload_sessions SET state='uploading',error_code=NULL,updated_at=sqlc.arg(updated_at) WHERE id=sqlc.arg(id);

-- name: GetUpload :one
SELECT id,tenant_id,workspace_id,user_id,caller_service,COALESCE(idempotency_key,'')::text AS idempotency_key,
category,filename,declared_media_type,COALESCE(declared_size_bytes,-1)::bigint AS size_bytes,state,
COALESCE(asset_id::text,'')::text AS asset_id,COALESCE(revision_id::text,'')::text AS revision_id,expires_at
FROM upload_sessions WHERE id=sqlc.arg(id) AND caller_service=sqlc.arg(caller_service) AND tenant_id=sqlc.arg(tenant_id) AND workspace_id=sqlc.arg(workspace_id);

-- name: FailUpload :exec
UPDATE upload_sessions SET state='failed', error_code=sqlc.arg(error_code), updated_at=sqlc.arg(updated_at) WHERE id=sqlc.arg(id) AND state='uploading';

-- name: CompleteUpload :exec
UPDATE upload_sessions SET state='completed',asset_id=sqlc.arg(asset_id),revision_id=sqlc.arg(revision_id),updated_at=sqlc.arg(updated_at) WHERE id=sqlc.arg(id);

-- name: CompleteAppendUpload :exec
UPDATE upload_sessions SET state='completed',asset_id=sqlc.arg(asset_id),revision_id=sqlc.arg(revision_id),updated_at=sqlc.arg(updated_at),expires_at=sqlc.arg(expires_at) WHERE id=sqlc.arg(id);

-- name: LockExpiredUploads :many
SELECT id FROM upload_sessions
WHERE state IN ('pending','uploading','failed','completed','aborted') AND expires_at <= sqlc.arg(expires_at)
ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT sqlc.arg(batch_size);

-- name: LeaseUploadCleanup :exec
UPDATE upload_sessions SET state='aborted',
error_code=COALESCE(error_code,'upload_expired'),expires_at=sqlc.arg(expires_at),updated_at=sqlc.arg(updated_at) WHERE id=sqlc.arg(id);

-- name: DeleteAbortedUpload :execrows
DELETE FROM upload_sessions WHERE id=sqlc.arg(id) AND state='aborted';
