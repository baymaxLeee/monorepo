-- name: NodeLibraryResolve :many
SELECT s.current_asset_id, s.media_type AS slot_media_type, d.active_task_run_id,
    coalesce(a.id, '')::text AS asset_id, coalesce(a.owner_type, 0)::smallint AS owner_type,
    coalesce(a.owner_id, '')::text AS owner_id, coalesce(a.file_name, '')::text AS file_name,
    coalesce(a.media_type, 0)::smallint AS media_type, coalesce(a.content_type, '')::text AS content_type,
    coalesce(a.size_bytes, 0)::bigint AS size_bytes, coalesce(a.source_asset_id, '')::text AS source_asset_id,
    coalesce(a.source_revision_id, '')::text AS source_revision_id, coalesce(a.created_by, '')::text AS created_by,
    coalesce(a.created_at, 'epoch')::timestamptz AS created_at,
    r.id AS resource_id, r.type, r.name AS resource_name, r.description, s.id AS resource_asset_id,
    s.name, s.revision AS resource_asset_revision, r.primary_resource_asset_id FROM resource_assets s
JOIN resources r ON r.id = s.resource_id AND r.deleted_at = 0
LEFT JOIN resource_asset_image_generation_drafts d ON d.id = s.image_generation_draft_id
    AND d.resource_asset_id = s.id AND d.resource_id = r.id AND d.tenant_id = r.tenant_id AND d.deleted_at = 0
JOIN assets a ON a.id = s.current_asset_id AND a.deleted_at = 0
WHERE r.tenant_id = @tenant_id AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar AND a.tenant_id = @tenant_id AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar AND s.deleted_at = 0 AND ((r.owner_type = @project_owner AND r.owner_id = @project_id) OR r.owner_type = @official_owner) AND ((NOT @primary_only::bool AND s.id = ANY(@ids::text[])) OR (@primary_only::bool AND r.id = ANY(@ids::text[]) AND s.id = r.primary_resource_asset_id));

-- name: NodeLibraryLooks :many
SELECT s.current_asset_id, s.media_type AS slot_media_type, d.active_task_run_id,
    coalesce(a.id, '')::text AS asset_id, coalesce(a.owner_type, 0)::smallint AS owner_type,
    coalesce(a.owner_id, '')::text AS owner_id, coalesce(a.file_name, '')::text AS file_name,
    coalesce(a.media_type, 0)::smallint AS media_type, coalesce(a.content_type, '')::text AS content_type,
    coalesce(a.size_bytes, 0)::bigint AS size_bytes, coalesce(a.source_asset_id, '')::text AS source_asset_id,
    coalesce(a.source_revision_id, '')::text AS source_revision_id, coalesce(a.created_by, '')::text AS created_by,
    coalesce(a.created_at, 'epoch')::timestamptz AS created_at,
    r.id AS resource_id, r.type, r.name AS resource_name, r.description, s.id AS resource_asset_id,
    s.name, s.revision AS resource_asset_revision, r.primary_resource_asset_id FROM resource_assets s
JOIN resources r ON r.id = s.resource_id AND r.deleted_at = 0
LEFT JOIN resource_asset_image_generation_drafts d ON d.id = s.image_generation_draft_id
    AND d.resource_asset_id = s.id AND d.resource_id = r.id AND d.tenant_id = r.tenant_id AND d.deleted_at = 0
LEFT JOIN assets a ON a.id = s.current_asset_id AND a.deleted_at = 0 AND
    ((r.owner_type = @project_owner AND a.owner_type = @resource_asset_owner AND a.owner_id = r.id) OR
     (r.owner_type = @official_owner AND a.owner_type = @official_asset_owner AND a.owner_id = r.owner_id))
WHERE r.tenant_id = @tenant_id AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar AND s.deleted_at = 0 AND r.id = ANY(@ids::text[])
    AND trim(s.name) <> '' AND s.media_type = ANY(@media_types::smallint[])
    AND (s.current_asset_id IS NULL OR (a.id IS NOT NULL AND a.tenant_id = @tenant_id AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar))
ORDER BY CASE WHEN r.primary_resource_asset_id = s.id THEN 0 ELSE 1 END, s.sequence_no, s.id;

-- name: NodeLibraryAssets :many
WITH refs AS (
    SELECT s.id FROM projects p JOIN resources r ON r.owner_type = @project_owner AND r.owner_id = p.id AND r.deleted_at = 0
    JOIN resource_assets s ON s.resource_id = r.id AND s.deleted_at = 0
    WHERE p.id = @project_id AND p.deleted_at = 0 AND r.tenant_id = @tenant_id AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar AND p.tenant_id = @tenant_id AND p.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
    ORDER BY r.updated_at DESC, r.id DESC, CASE WHEN r.primary_resource_asset_id = s.id THEN 0 ELSE 1 END, s.sequence_no, s.id
    LIMIT @page_size
) SELECT s.current_asset_id, s.media_type AS slot_media_type, d.active_task_run_id,
    coalesce(a.id, '')::text AS asset_id, coalesce(a.owner_type, 0)::smallint AS owner_type,
    coalesce(a.owner_id, '')::text AS owner_id, coalesce(a.file_name, '')::text AS file_name,
    coalesce(a.media_type, 0)::smallint AS media_type, coalesce(a.content_type, '')::text AS content_type,
    coalesce(a.size_bytes, 0)::bigint AS size_bytes, coalesce(a.source_asset_id, '')::text AS source_asset_id,
    coalesce(a.source_revision_id, '')::text AS source_revision_id, coalesce(a.created_by, '')::text AS created_by,
    coalesce(a.created_at, 'epoch')::timestamptz AS created_at,
    r.id AS resource_id, r.type, r.name AS resource_name, r.description, s.id AS resource_asset_id,
    s.name, s.revision AS resource_asset_revision, r.primary_resource_asset_id FROM resource_assets s
JOIN resources r ON r.id = s.resource_id AND r.deleted_at = 0
LEFT JOIN resource_asset_image_generation_drafts d ON d.id = s.image_generation_draft_id
    AND d.resource_asset_id = s.id AND d.resource_id = r.id AND d.tenant_id = r.tenant_id AND d.deleted_at = 0
JOIN refs ON refs.id = s.id JOIN assets a ON a.id = s.current_asset_id AND a.deleted_at = 0
WHERE a.tenant_id = @tenant_id AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar ORDER BY r.updated_at DESC, r.id DESC, CASE WHEN r.primary_resource_asset_id = s.id THEN 0 ELSE 1 END, s.sequence_no, s.id;

-- name: NodeLibrarySearch :many
SELECT r.id AS resource_id, r.type, r.name, r.description, r.primary_resource_asset_id, r.revision, r.created_at, r.updated_at FROM resources r
WHERE r.deleted_at = 0 AND r.tenant_id = @tenant_id AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar AND ((r.owner_type = @project_owner AND r.owner_id = @project_id) OR r.owner_type = @official_owner)
    AND EXISTS (SELECT 1 FROM projects p WHERE p.id = @project_id AND p.deleted_at = 0 AND p.tenant_id = @tenant_id AND p.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar)
    AND EXISTS (SELECT 1 FROM resource_assets s WHERE s.resource_id = r.id AND s.deleted_at = 0 AND trim(s.name) <> '')
    AND (r.name LIKE @pattern OR r.description LIKE @pattern)
    AND (cardinality(@types::smallint[]) = 0 OR r.type = ANY(@types::smallint[]))
    AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (r.created_at, r.id) < (sqlc.narg(cursor_time)::timestamptz, @cursor_id::text))
ORDER BY r.created_at DESC, r.id DESC LIMIT @page_size;
