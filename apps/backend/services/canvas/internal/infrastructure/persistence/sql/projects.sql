-- name: ActiveProjectExists :one
SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE id = sqlc.arg(project_id)
      AND tenant_id = sqlc.arg(tenant_id)
      AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
      AND deleted_at = 0
);

-- name: ListProjectMemberIDs :many
SELECT user_id FROM project_members
WHERE project_id=$1 AND tenant_id=$2
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at=0
ORDER BY id;
