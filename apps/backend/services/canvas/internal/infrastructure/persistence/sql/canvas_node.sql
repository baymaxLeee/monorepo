-- name: NodeFindProject :one
SELECT id FROM projects
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = @id;

-- name: NodeFindCanvas :one
SELECT revision FROM canvases
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = @id
  AND project_id = @project_id;

-- name: NodeGet :one
SELECT * FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = @id;

-- name: NodeList :many
SELECT * FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
ORDER BY storyboard_rank, id;

-- name: NodeFindProjectLocked :one
SELECT id FROM projects
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = @id
FOR SHARE;

-- name: NodeFindCanvasLocked :one
SELECT revision FROM canvases
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = @id
  AND project_id = @project_id
FOR UPDATE;

-- name: NodeGetLocked :one
SELECT * FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = @id
FOR UPDATE;

-- name: NodeListLocked :many
SELECT * FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
ORDER BY storyboard_rank, id
FOR UPDATE;

-- name: NodeVideoIDs :many
SELECT id FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND type = @type
ORDER BY storyboard_rank, id;

-- name: NodeVideoNodesLocked :many
SELECT * FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND type = @type
ORDER BY storyboard_rank, id
FOR UPDATE;

-- name: NodeBatch :many
SELECT * FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = ANY(@ids::text[]);

-- name: NodeGetByID :one
SELECT * FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = @id;

-- name: NodeCount :one
SELECT count(*) FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id;

-- name: NodeCountPreceding :one
SELECT count(*) FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND storyboard_rank < @rank;

-- name: NodeDeletionMatches :one
SELECT count(*) FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = @deleted_at
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = @id
  AND revision = @revision;

-- name: NodeFirstFrames :many
WITH first_nodes AS (
    SELECT DISTINCT ON (canvas_id) canvas_id, id, selected_output_id FROM canvas_nodes
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = ANY(@canvas_ids::text[])
  AND type = @type
ORDER BY canvas_id, storyboard_rank, id
)
SELECT n.canvas_id, g.first_frame_asset_id, g.task_run_id FROM first_nodes n JOIN canvas_node_generations g
ON g.canvas_id = n.canvas_id
  AND g.node_id = n.id
  AND g.task_run_id = n.selected_output_id
WHERE g.tenant_id = @tenant_id
  AND g.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND g.project_id = @project_id
  AND g.first_frame_asset_id IS NOT NULL;

-- name: NodeMetadata :many
SELECT task_run_id, node_id, first_frame_asset_id, last_frame_asset_id, output_duration_seconds FROM canvas_node_generations
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND task_run_id = ANY(@ids::text[]);

-- name: NodeInsert :exec
INSERT INTO canvas_nodes (
    id, tenant_id, workspace_id, project_id, canvas_id, type, storyboard_rank, asset_id,
    resource_id, resource_asset_id, revision, active_task_run_id, selected_output_id,
    selected_asset_id, created_by, updated_by, created_at, updated_at, deleted_at, node_data
) VALUES (
    @id, @tenant_id, @workspace_id, @project_id, @canvas_id, @type, @storyboard_rank,
    @asset_id, @resource_id, @resource_asset_id, @revision, @active_task_run_id,
    @selected_output_id, @selected_asset_id, @created_by, @updated_by, @created_at,
    @updated_at, 0, @node_data
);

-- name: NodeRebalance :execrows
UPDATE canvas_nodes
SET storyboard_rank = @rank
WHERE id = @id
  AND deleted_at = 0;

-- name: NodeBindResource :execrows
UPDATE canvas_nodes
SET asset_id = NULL,
    resource_id = NULL,
    resource_asset_id = @resource_asset_id,
    node_data = @node_data,
    selected_output_id = NULL,
    selected_asset_id = NULL,
    revision = revision + 1,
    updated_by = @updated_by,
    updated_at = @updated_at
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = @id
  AND revision = @revision;

-- name: NodePatch :execrows
UPDATE canvas_nodes
SET node_data = @node_data,
    revision = revision + 1,
    updated_by = @updated_by,
    updated_at = @updated_at,
    active_task_run_id = CASE WHEN @revoke::bool THEN NULL ELSE active_task_run_id END
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = @id
  AND revision = @revision;

-- name: NodeClaim :execrows
UPDATE canvas_nodes
SET active_task_run_id = @run_id,
    updated_at = now()
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = @id
  AND revision = @revision
  AND active_task_run_id IS NULL;

-- name: NodeRelease :execrows
UPDATE canvas_nodes
SET active_task_run_id = NULL,
    updated_at = now()
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = @id
  AND active_task_run_id = @run_id;

-- name: NodeSelectAsset :execrows
UPDATE canvas_nodes
SET resource_id = NULL,
    resource_asset_id = NULL,
    selected_output_id = @run_id,
    selected_asset_id = @asset_id,
    updated_by = @updated_by,
    updated_at = @updated_at,
    active_task_run_id = CASE WHEN @bind::bool THEN NULL ELSE active_task_run_id END
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = @id
  AND type = @type
  AND (NOT @bind::bool OR active_task_run_id = @run_id);

-- name: NodeSelectText :execrows
UPDATE canvas_nodes
SET selected_output_id = @run_id,
    selected_asset_id = NULL,
    node_data = @node_data,
    updated_by = @updated_by,
    updated_at = @updated_at,
    active_task_run_id = CASE WHEN @bind::bool THEN NULL ELSE active_task_run_id END
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = @id;

-- name: NodeDelete :execrows
UPDATE canvas_nodes
SET active_task_run_id = NULL,
    updated_by = @updated_by,
    updated_at = @updated_at,
    deleted_at = @deleted_at
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = ANY(@ids::text[]);

-- name: NodeUpdateRank :execrows
UPDATE canvas_nodes
SET storyboard_rank = @rank,
    revision = revision + 1,
    updated_by = @updated_by,
    updated_at = @updated_at
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND id = @id
  AND type = @type;

-- name: NodeAdvanceRevision :execrows
UPDATE canvases
SET revision = revision + 1,
    updated_at = @updated_at
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = @project_id
  AND id = @id
  AND revision = @revision;
