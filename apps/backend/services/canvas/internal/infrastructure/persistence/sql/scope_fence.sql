-- name: EnsureScopeFence :exec
INSERT INTO scope_deletion_fences(id, tenant_id, workspace_id, created_at)
VALUES ($1, $2, $3, now()) ON CONFLICT (id) DO NOTHING;

-- name: ReadScopeFence :one
SELECT (closed_at IS NULL)::boolean AS active FROM scope_deletion_fences WHERE id=$1 FOR SHARE;

-- name: CloseScopeFence :exec
UPDATE scope_deletion_fences SET closed_at=now() WHERE id=$1 AND closed_at IS NULL;
