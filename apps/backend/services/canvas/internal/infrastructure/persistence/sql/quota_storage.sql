-- name: ReadQuotaCounter :one
SELECT
    *
FROM resource_usage_counters
WHERE
    scope_type = @scope_type
    AND scope_id = @scope_id
    AND resource_type = @resource_type;

-- name: LockQuotaCounter :one
SELECT
    *
FROM resource_usage_counters
WHERE
    scope_type = @scope_type
    AND scope_id = @scope_id
    AND resource_type = @resource_type
FOR UPDATE;

-- name: LockQuotaReservation :one
SELECT
    *
FROM resource_quota_reservations
WHERE
    id = $1
FOR UPDATE;

-- name: LockQuotaReservationByKey :one
SELECT
    *
FROM resource_quota_reservations
WHERE
    idempotency_key = $1
FOR UPDATE;

-- name: LockQuotaObject :one
SELECT
    *
FROM tenant_storage_usage_ledger
WHERE
    object_type = @object_type
    AND object_key = @object_key
FOR UPDATE;

-- name: SerializeQuotaReservationKey :exec
SELECT
    pg_advisory_xact_lock(hashtextextended (@idempotency_key::text, 0));

-- name: EnsureQuotaCounter :exec
INSERT INTO resource_usage_counters (scope_type, scope_id, resource_type, updated_at)
VALUES
    ($1, $2, $3, $4)
ON CONFLICT (scope_type, scope_id, resource_type) DO NOTHING;

-- name: SaveQuotaCounter :exec
UPDATE resource_usage_counters
SET
    used_value = @used_value,
    reserved_value = @reserved_value,
    revision = @revision,
    report_dirty = @report_dirty,
    updated_at = @updated_at
WHERE
    scope_type = @scope_type
    AND scope_id = @scope_id
    AND resource_type = @resource_type;

-- name: SaveQuotaReservation :exec
UPDATE resource_quota_reservations
SET
    status = @status,
    state_version = @state_version,
    target_type = @target_type,
    target_id = @target_id,
    expires_at = @expires_at,
    updated_at = @updated_at,
    would_reject = @would_reject,
    pending_cleanup_count = @pending_cleanup_count
WHERE
    id = @id;

-- name: ChangeQuotaObjectClass :exec
UPDATE tenant_storage_usage_ledger
SET
    billing_class = @billing_class
WHERE
    object_type = @object_type
    AND object_key = @object_key;

-- name: ReleaseQuotaObject :exec
UPDATE tenant_storage_usage_ledger
SET
    status = @status,
    released_at = @released_at
WHERE
    object_type = @object_type
    AND object_key = @object_key;

-- name: InsertQuotaObject :exec
INSERT INTO tenant_storage_usage_ledger (
        object_type, object_key, tenant_id, workspace_id, category, owner_type, owner_id, size_bytes,
        billing_class, status, created_at, released_at
    )
VALUES
    (
        @object_type, @object_key, @tenant_id, @workspace_id, @category, @owner_type, @owner_id, @size_bytes,
        @billing_class, @status, @created_at, @released_at
    );

-- name: EnsureQuotaObject :execrows
INSERT INTO tenant_storage_usage_ledger (
        object_type, object_key, tenant_id, workspace_id, category, owner_type, owner_id, size_bytes,
        billing_class, status, created_at, released_at
    )
VALUES
    (
        @object_type, @object_key, @tenant_id, @workspace_id, @category, @owner_type, @owner_id, @size_bytes,
        @billing_class, @status, @created_at, @released_at
    )
ON CONFLICT (object_type, object_key) DO NOTHING;

-- name: InsertQuotaReservation :exec
INSERT INTO resource_quota_reservations (
        id, tenant_id, resource_type, idempotency_key, reserved_value, would_reject, status, state_version,
        pending_cleanup_count, target_type, target_id, expires_at, created_at, updated_at
    )
VALUES
    (
        @id, @tenant_id, @resource_type, @idempotency_key, @reserved_value, @would_reject, @status,
        @state_version, @pending_cleanup_count, @target_type, @target_id, @expires_at, @created_at,
        @updated_at
    );

-- name: ClaimDirtyQuotaReports :many
WITH
    due AS (
        SELECT
            c.scope_type,
            c.scope_id,
            c.resource_type
        FROM resource_usage_counters c
        WHERE
            c.scope_type = 'tenant'
            AND c.report_dirty
            AND (
                c.report_lease_until IS NULL
                OR c.report_lease_until <= @now::pg_catalog.timestamptz
            )
        ORDER BY
            c.scope_id,
            c.resource_type
        LIMIT
            @page_size::bigint
        FOR UPDATE
            SKIP LOCKED
    ),
    claimed AS (
        UPDATE resource_usage_counters c
        SET
            report_lease_token = @owner::varchar,
            report_lease_until = @lease::pg_catalog.timestamptz
        FROM due
        WHERE
            (c.scope_type, c.scope_id, c.resource_type) = (due.scope_type, due.scope_id, due.resource_type)
        RETURNING
            c.scope_id,
            c.resource_type,
            c.used_value,
            c.revision
    )
SELECT
    *
FROM claimed
ORDER BY
    scope_id,
    resource_type;

-- name: FinishQuotaReport :execrows
UPDATE resource_usage_counters
SET
    report_dirty = FALSE,
    last_reported_value = @value,
    last_reported_at = @now::pg_catalog.timestamptz,
    report_lease_token = '',
    report_lease_until = NULL
WHERE
    scope_type = 'tenant'
    AND scope_id = @tenant_id
    AND resource_type = @resource
    AND revision = @revision
    AND report_lease_token = @owner::varchar;

-- name: AggregateQuotaProjects :many
SELECT
    tenant_id,
    COUNT(*) AS total
FROM projects
WHERE
    deleted_at = 0
GROUP BY
    tenant_id;

-- name: AggregateQuotaPresets :many
SELECT
    tenant_id,
    COALESCE(SUM(reserved_value), 0)::bigint AS total
FROM resource_quota_reservations
WHERE
    resource_type = @resource
    AND status IN ('committed', 'releasing', 'reacquiring')
GROUP BY
    tenant_id;

-- name: AggregateQuotaStorage :many
SELECT
    tenant_id,
    COALESCE(SUM(size_bytes), 0)::bigint AS total
FROM tenant_storage_usage_ledger
WHERE
    billing_class = 'billable'
    AND status IN ('active', 'releasing')
GROUP BY
    tenant_id;

-- name: QuotaCounterTenants :many
SELECT
    scope_id
FROM resource_usage_counters
WHERE
    scope_type = 'tenant'
    AND resource_type = $1
ORDER BY
    scope_id;

-- name: LockExpiredQuotaReservations :many
SELECT
    *
FROM resource_quota_reservations
WHERE
    status IN ('pending', 'reacquiring')
    AND expires_at <= $1
ORDER BY
    tenant_id,
    id
FOR UPDATE;

-- name: QuotaProjectExists :one
SELECT
    EXISTS (
        SELECT
            1
        FROM projects
        WHERE
            tenant_id = @tenant_id
            AND id = @id
            AND deleted_at = 0
    );

-- name: QuotaReviewExists :one
SELECT
    EXISTS (
        SELECT
            1
        FROM asset_reviews
        WHERE
            tenant_id = @tenant_id
            AND id = @id
            AND submitted_at IS NOT NULL
            AND deleted_at = 0
    );

-- name: QuotaTargetObjectExists :one
SELECT
    EXISTS (
        SELECT
            1
        FROM tenant_storage_usage_ledger
        WHERE
            tenant_id = @tenant_id
            AND owner_type = @owner_type
            AND owner_id = @id
            AND status IN ('active', 'releasing')
    );

-- name: MarkQuotaObjectReleasing :execrows
UPDATE tenant_storage_usage_ledger
SET
    status = 'releasing'
WHERE
    object_type = @object_type
    AND object_key = @object_key
    AND status IN ('active', 'releasing');
