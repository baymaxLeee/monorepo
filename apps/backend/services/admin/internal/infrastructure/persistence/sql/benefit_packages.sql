-- name: ListBenefitPackages :many
SELECT
    id,
    tenant_id,
    workspace_id,
    is_preset,
    name,
    project_name,
    asset_group_id,
    access_key_id_enc,
    secret_access_key_enc,
    enabled,
    model_ids_json,
    material_used,
    material_limit,
    revision,
    created_by,
    updated_by,
    created_at,
    updated_at,
    deleted_at
FROM
    benefit_packages
WHERE
    tenant_id = $1
    AND workspace_id = $2
    AND deleted_at IS NULL
ORDER BY
    is_preset DESC,
    updated_at DESC;

-- name: GetBenefitPackage :one
SELECT
    id,
    tenant_id,
    workspace_id,
    is_preset,
    name,
    project_name,
    asset_group_id,
    access_key_id_enc,
    secret_access_key_enc,
    enabled,
    model_ids_json,
    material_used,
    material_limit,
    revision,
    created_by,
    updated_by,
    created_at,
    updated_at,
    deleted_at
FROM
    benefit_packages
WHERE
    id = $1
    AND tenant_id = $2
    AND workspace_id = $3
    AND deleted_at IS NULL;

-- name: GetBenefitPackageForUpdate :one
SELECT
    id,
    tenant_id,
    workspace_id,
    is_preset,
    name,
    project_name,
    asset_group_id,
    access_key_id_enc,
    secret_access_key_enc,
    enabled,
    model_ids_json,
    material_used,
    material_limit,
    revision,
    created_by,
    updated_by,
    created_at,
    updated_at,
    deleted_at
FROM
    benefit_packages
WHERE
    id = $1
    AND tenant_id = $2
    AND workspace_id = $3
    AND deleted_at IS NULL
FOR UPDATE;

-- name: CreateBenefitPackage :exec
INSERT INTO
    benefit_packages (
        id,
        tenant_id,
        workspace_id,
        is_preset,
        name,
        project_name,
        asset_group_id,
        access_key_id_enc,
        secret_access_key_enc,
        enabled,
        model_ids_json,
        material_used,
        material_limit,
        revision,
        created_by,
        updated_by,
        created_at,
        updated_at
    )
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18);

-- name: SaveBenefitPackage :exec
UPDATE benefit_packages
SET
    name = $2,
    project_name = $3,
    asset_group_id = $4,
    access_key_id_enc = $5,
    secret_access_key_enc = $6,
    enabled = $7,
    model_ids_json = $8,
    material_used = $9,
    material_limit = $10,
    revision = $11,
    updated_by = $12,
    updated_at = $13,
    deleted_at = $14
WHERE
    id = $1;

-- name: ClearBenefitPackageModels :exec
DELETE FROM benefit_package_models
WHERE
    package_id = $1;

-- name: AddBenefitPackageModel :exec
INSERT INTO
    benefit_package_models (package_id, tenant_id, workspace_id, model_id)
VALUES
    ($1, $2, $3, $4);

-- name: ReviewUsage :many
SELECT
    benefit_package_id,
    COUNT(*) FILTER (
        WHERE
            status IN ('committed', 'releasing', 'reacquiring')
    ) AS committed,
    COUNT(*) FILTER (
        WHERE
            status = 'reserved'
    ) AS reserved
FROM
    benefit_package_review_reservations
WHERE
    tenant_id = $1
    AND workspace_id = $2
GROUP BY
    benefit_package_id;

-- name: GetReviewReservation :one
SELECT
    id,
    tenant_id,
    workspace_id,
    benefit_package_id,
    project_id,
    asset_id,
    operation_id,
    status,
    created_at,
    updated_at
FROM
    benefit_package_review_reservations
WHERE
    id = $1;

-- name: GetReviewReservationForUpdate :one
SELECT
    id,
    tenant_id,
    workspace_id,
    benefit_package_id,
    project_id,
    asset_id,
    operation_id,
    status,
    created_at,
    updated_at
FROM
    benefit_package_review_reservations
WHERE
    id = $1
FOR UPDATE;

-- name: GetReviewReservationByOperation :one
SELECT
    id,
    tenant_id,
    workspace_id,
    benefit_package_id,
    project_id,
    asset_id,
    operation_id,
    status,
    created_at,
    updated_at
FROM
    benefit_package_review_reservations
WHERE
    operation_id = $1;

-- name: GetReviewReservationByOperationForUpdate :one
SELECT
    id,
    tenant_id,
    workspace_id,
    benefit_package_id,
    project_id,
    asset_id,
    operation_id,
    status,
    created_at,
    updated_at
FROM
    benefit_package_review_reservations
WHERE
    operation_id = $1
FOR UPDATE;

-- name: GetActiveReviewReservation :one
SELECT
    id,
    tenant_id,
    workspace_id,
    benefit_package_id,
    project_id,
    asset_id,
    operation_id,
    status,
    created_at,
    updated_at
FROM
    benefit_package_review_reservations
WHERE
    benefit_package_id = $1
    AND project_id = $2
    AND asset_id = $3
    AND status IN ('reserved', 'committed', 'releasing', 'reacquiring');

-- name: GetActiveReviewReservationForUpdate :one
SELECT
    id,
    tenant_id,
    workspace_id,
    benefit_package_id,
    project_id,
    asset_id,
    operation_id,
    status,
    created_at,
    updated_at
FROM
    benefit_package_review_reservations
WHERE
    benefit_package_id = $1
    AND project_id = $2
    AND asset_id = $3
    AND status IN ('reserved', 'committed', 'releasing', 'reacquiring')
FOR UPDATE;

-- name: CreateReviewReservation :exec
INSERT INTO
    benefit_package_review_reservations (
        id,
        tenant_id,
        workspace_id,
        benefit_package_id,
        project_id,
        asset_id,
        operation_id,
        status,
        created_at,
        updated_at
    )
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: SaveReviewReservation :exec
UPDATE benefit_package_review_reservations
SET
    operation_id = $2,
    status = $3,
    updated_at = $4
WHERE
    id = $1;

-- name: GetReviewCleanup :one
SELECT
    cleanup_id,
    reservation_id,
    status,
    created_at,
    completed_at
FROM
    benefit_package_review_cleanup_claims
WHERE
    cleanup_id = $1;

-- name: GetReviewCleanupForUpdate :one
SELECT
    cleanup_id,
    reservation_id,
    status,
    created_at,
    completed_at
FROM
    benefit_package_review_cleanup_claims
WHERE
    cleanup_id = $1
FOR UPDATE;

-- name: CreateReviewCleanup :exec
INSERT INTO
    benefit_package_review_cleanup_claims (cleanup_id, reservation_id, status, created_at, completed_at)
VALUES
    ($1, $2, $3, $4, $5);

-- name: SaveReviewCleanup :exec
UPDATE benefit_package_review_cleanup_claims
SET
    status = $2,
    completed_at = $3
WHERE
    cleanup_id = $1;

-- name: CountPendingReviewCleanups :one
SELECT
    COUNT(*)
FROM
    benefit_package_review_cleanup_claims
WHERE
    reservation_id = $1
    AND status = 'pending';

-- name: ListAssetGroupCleanups :many
SELECT
    id,
    tenant_id,
    workspace_id,
    benefit_package_id,
    asset_group_id,
    project_name,
    access_key_id_enc,
    secret_access_key_enc,
    status,
    lease_token,
    lease_until,
    attempts,
    last_error,
    created_at,
    updated_at,
    completed_at
FROM
    benefit_package_asset_group_cleanups
WHERE
    tenant_id = $1
    AND workspace_id = $2
ORDER BY
    updated_at DESC;

-- name: GetAssetGroupCleanup :one
SELECT
    id,
    tenant_id,
    workspace_id,
    benefit_package_id,
    asset_group_id,
    project_name,
    access_key_id_enc,
    secret_access_key_enc,
    status,
    lease_token,
    lease_until,
    attempts,
    last_error,
    created_at,
    updated_at,
    completed_at
FROM
    benefit_package_asset_group_cleanups
WHERE
    id = $1
    AND tenant_id = $2
    AND workspace_id = $3;

-- name: GetAssetGroupCleanupForUpdate :one
SELECT
    id,
    tenant_id,
    workspace_id,
    benefit_package_id,
    asset_group_id,
    project_name,
    access_key_id_enc,
    secret_access_key_enc,
    status,
    lease_token,
    lease_until,
    attempts,
    last_error,
    created_at,
    updated_at,
    completed_at
FROM
    benefit_package_asset_group_cleanups
WHERE
    id = $1
    AND tenant_id = $2
    AND workspace_id = $3
FOR UPDATE;

-- name: CreateAssetGroupCleanup :exec
INSERT INTO
    benefit_package_asset_group_cleanups (
        id,
        tenant_id,
        workspace_id,
        benefit_package_id,
        asset_group_id,
        project_name,
        access_key_id_enc,
        secret_access_key_enc,
        status,
        lease_token,
        lease_until,
        attempts,
        last_error,
        created_at,
        updated_at,
        completed_at
    )
VALUES
    (
        sqlc.arg (id),
        sqlc.arg (tenant_id),
        sqlc.arg (workspace_id),
        sqlc.arg (benefit_package_id),
        sqlc.arg (asset_group_id),
        sqlc.arg (project_name),
        sqlc.arg (access_key_id_enc),
        sqlc.arg (secret_access_key_enc),
        sqlc.arg (status),
        sqlc.arg (lease_token),
        sqlc.arg (lease_until),
        sqlc.arg (attempts)::bigint,
        sqlc.arg (last_error),
        sqlc.arg (created_at),
        sqlc.arg (updated_at),
        sqlc.arg (completed_at)
    )
ON CONFLICT (asset_group_id) DO NOTHING;

-- name: SaveAssetGroupCleanup :exec
UPDATE benefit_package_asset_group_cleanups
SET
    status = sqlc.arg (status),
    lease_token = sqlc.arg (lease_token),
    lease_until = sqlc.arg (lease_until),
    attempts = sqlc.arg (attempts)::bigint,
    last_error = sqlc.arg (last_error),
    updated_at = sqlc.arg (updated_at),
    completed_at = sqlc.arg (completed_at)
WHERE
    id = sqlc.arg (id);
