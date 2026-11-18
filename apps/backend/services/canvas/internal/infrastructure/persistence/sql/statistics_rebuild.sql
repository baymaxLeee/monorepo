-- name: LockCanvasStatistics :one
SELECT id FROM canvases
WHERE id = @canvas_id AND tenant_id = @tenant_id AND project_id = @project_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar AND deleted_at = 0
FOR UPDATE;

-- name: RebuildCanvasStatistics :exec
WITH nodes AS (
    SELECT n.selected_output_id, n.selected_asset_id,
           COALESCE(g.output_duration_seconds, g.duration_seconds)::bigint AS output_seconds,
           n.node_data #>> '{payload,generation_config,duration_seconds}' AS configured_seconds
    FROM canvas_nodes n
    LEFT JOIN canvas_node_generations g ON g.task_run_id = n.selected_output_id
    WHERE n.canvas_id = @canvas_id AND n.project_id = @project_id AND n.tenant_id = @tenant_id
      AND n.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
      AND n.type = @node_type AND n.deleted_at = 0
), stats AS (
    SELECT COUNT(*)::integer AS node_count,
           COALESCE(SUM(CASE
               WHEN selected_output_id IS NOT NULL AND output_seconds > 0 THEN output_seconds * 1000
               WHEN selected_asset_id IS NOT NULL AND configured_seconds::bigint > 0 THEN configured_seconds::bigint * 1000
               ELSE 0 END), 0)::bigint AS duration_ms
    FROM nodes
)
UPDATE canvases c SET canvas_node_count = stats.node_count, selected_video_duration_millis = stats.duration_ms
FROM stats WHERE c.id = @canvas_id AND c.tenant_id = @tenant_id AND c.project_id = @project_id
  AND c.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar AND c.deleted_at = 0;

-- name: LockProjectStatistics :one
SELECT id FROM projects
WHERE id = @project_id AND tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar AND deleted_at = 0
FOR UPDATE;

-- name: RebuildProjectStatistics :exec
UPDATE projects p SET
    canvas_count = CASE WHEN @update_canvas_count::boolean THEN (
        SELECT COUNT(*) FROM canvases c
        WHERE c.project_id = p.id AND c.tenant_id = p.tenant_id
          AND c.workspace_id IS NOT DISTINCT FROM p.workspace_id AND c.deleted_at = 0
    ) ELSE p.canvas_count END,
    selected_video_duration_millis = CASE WHEN @update_duration::boolean THEN (
        SELECT COALESCE(SUM(c.selected_video_duration_millis), 0) FROM canvases c
        WHERE c.project_id = p.id AND c.tenant_id = p.tenant_id
          AND c.workspace_id IS NOT DISTINCT FROM p.workspace_id AND c.deleted_at = 0
    ) ELSE p.selected_video_duration_millis END,
    resource_count = CASE WHEN @update_resource_count::boolean THEN (
        SELECT COUNT(*) FROM resources r
        WHERE r.owner_type = @project_owner_type AND r.owner_id = p.id AND r.tenant_id = p.tenant_id
          AND r.workspace_id IS NOT DISTINCT FROM p.workspace_id AND r.deleted_at = 0
    ) ELSE p.resource_count END
WHERE p.id = @project_id AND p.tenant_id = @tenant_id
  AND p.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar AND p.deleted_at = 0;
