-- name: GetCanvasSettings :one
SELECT
    revision,
    defaults_json
FROM
    canvas_settings
WHERE
    workspace_id = $1
    AND tenant_id = $2;

-- name: CreateCanvasSettings :execrows
INSERT INTO
    canvas_settings (workspace_id, tenant_id, revision, defaults_json, updated_by, updated_at)
VALUES
    ($1, $2, 1, $3, $4, now())
ON CONFLICT DO NOTHING;

-- name: UpdateCanvasSettings :execrows
UPDATE canvas_settings
SET
    revision = revision + 1,
    defaults_json = $4,
    updated_by = $5,
    updated_at = now()
WHERE
    workspace_id = $1
    AND tenant_id = $2
    AND revision = $3;
