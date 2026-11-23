-- name: ListActiveMemories :many
SELECT * FROM user_memories
WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3 AND status = 'active'
ORDER BY created_at;

-- name: ListPendingMemoryCandidates :many
SELECT * FROM user_memories
WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3 AND status = 'pending'
ORDER BY created_at;

-- name: GetMemoryForUpdate :one
SELECT * FROM user_memories
WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4
FOR UPDATE;

-- name: ActivateMemoryCandidate :one
UPDATE user_memories
SET status = 'active', source = 'user-approved', confidence = 100, updated_at = $1
WHERE id = $2 AND tenant_id = $3 AND workspace_id = $4 AND user_id = $5 AND status = 'pending'
RETURNING *;

-- name: SupersedeActiveMemory :exec
UPDATE user_memories
SET status = 'superseded', updated_at = $1
WHERE id = $2 AND tenant_id = $3 AND workspace_id = $4 AND user_id = $5 AND status = 'active';

-- name: RejectMemoryCandidate :one
UPDATE user_memories
SET status = 'rejected', updated_at = $1
WHERE id = $2 AND tenant_id = $3 AND workspace_id = $4 AND user_id = $5 AND status = 'pending'
RETURNING id;

-- name: UpdateMemoryCandidate :one
UPDATE user_memories
SET category = COALESCE(sqlc.narg('category'), category),
    content = COALESCE(sqlc.narg('content'), content),
    updated_at = $1
WHERE id = $2 AND tenant_id = $3 AND workspace_id = $4 AND user_id = $5 AND status = 'pending'
RETURNING *;

-- name: DeleteMemory :one
DELETE FROM user_memories
WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4
RETURNING id;
