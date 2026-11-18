-- name: StoryboardList :many
SELECT * FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND created_by = @created_by
  AND type = @type
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
ORDER BY created_at, id;

-- name: StoryboardGet :one
SELECT * FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND created_by = @created_by
  AND type = @type
  AND deleted_at = 0
  AND id = @id
  AND (NOT @filter_canvas::bool OR (project_id = @project_id
  AND canvas_id = @canvas_id));

-- name: StoryboardGetLocked :one
SELECT * FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND created_by = @created_by
  AND type = @type
  AND deleted_at = 0
  AND id = @id
  AND (NOT @filter_canvas::bool OR (project_id = @project_id
  AND canvas_id = @canvas_id))
FOR UPDATE;

-- name: StoryboardSave :execrows
UPDATE canvas_nodes
SET node_data = @node_data,
    updated_at = @updated_at,
    updated_by = @created_by
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND created_by = @created_by
  AND type = @type
  AND deleted_at = 0
  AND id = @id
  AND (NOT @filter_canvas::bool OR (project_id = @project_id
  AND canvas_id = @canvas_id));
