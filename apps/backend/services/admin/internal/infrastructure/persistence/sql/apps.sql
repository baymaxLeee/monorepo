-- name: ListApps :many
SELECT
    *
FROM
    apps
WHERE
    (
        sqlc.arg (include_disabled)::boolean
        OR is_enabled
    )
    AND (
        sqlc.arg (include_admin)::boolean
        OR NOT requires_admin
    )
ORDER BY
    sort_order,
    title;

-- name: GetApp :one
SELECT
    *
FROM
    apps
WHERE
    id = $1;

-- name: CreateApp :one
INSERT INTO
    apps (
        id,
        title,
        base_path,
        remote_name,
        expose_key,
        entry,
        requires_admin,
        is_enabled,
        sort_order,
        created_at,
        updated_at
    )
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, sqlc.arg (sort_order)::bigint, $9, $9)
RETURNING
    *;

-- name: UpdateApp :one
UPDATE apps
SET
    title = $2,
    base_path = $3,
    remote_name = $4,
    expose_key = $5,
    entry = $6,
    requires_admin = $7,
    is_enabled = $8,
    sort_order = sqlc.arg (sort_order)::bigint,
    updated_at = now()
WHERE
    id = $1
RETURNING
    *;

-- name: DeleteApp :execrows
DELETE FROM apps
WHERE
    id = $1;
