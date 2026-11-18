-- name: InsertUsageCall :exec
INSERT INTO task_run_provider_calls (
        task_run_id, call_ordinal, call_type, project_id, model_id, model_name, model_source,
        request_started_at, request_id, capture_result, billing_status, settlement_reason, amount, currency,
        review_reason, state_version, created_at, updated_at, finalized_at
    )
VALUES
    (
        @task_run_id, @call_ordinal, @call_type, @project_id, @model_id, @model_name, @model_source,
        @request_started_at, @request_id, @capture_result, @billing_status, @settlement_reason,
        NULLIF(@amount::text, '')::numeric,
        @currency, @review_reason, @state_version, @created_at, @updated_at, @finalized_at
    )
ON CONFLICT (task_run_id, call_ordinal) DO NOTHING;

-- name: InsertUsageRecord :exec
INSERT INTO project_usage_records (
        task_run_id, tenant_id, workspace_id, project_id, run_type, resource_type, model_id, model_name,
        model_source, created_by, created_by_name, created_by_name_resolved_at, consumed_at, call_count,
        final_call_count, billing_status, total_amount, currency, billing_attempts, no_progress_attempts,
        next_attempt_at, lease_owner, lease_until, state_version, review_reason, created_at, updated_at,
        billing_finalized_at
    )
VALUES
    (
        @task_run_id, @tenant_id, @workspace_id, @project_id, @run_type, @resource_type, @model_id,
        @model_name, @model_source, @created_by, @created_by_name, @created_by_name_resolved_at, @consumed_at,
        @call_count, @final_call_count, @billing_status,
        NULLIF(@total_amount::text, '')::numeric,
        @currency, @billing_attempts, @no_progress_attempts, @next_attempt_at, @lease_owner, @lease_until,
        @state_version, @review_reason, @created_at, @updated_at, @billing_finalized_at
    )
ON CONFLICT (task_run_id) DO NOTHING;

-- name: ReadUsageCall :one
SELECT
    task_run_id, call_ordinal, call_type, project_id, model_id, model_name, model_source, request_started_at,
    request_id, capture_result, billing_status, settlement_reason,
    COALESCE(amount::text, '')::text AS amount,
    currency, review_reason, state_version, created_at, updated_at, finalized_at
FROM task_run_provider_calls
WHERE
    task_run_id = @id
    AND call_ordinal = @ordinal;

-- name: ListUsageCalls :many
SELECT
    task_run_id, call_ordinal, call_type, project_id, model_id, model_name, model_source, request_started_at,
    request_id, capture_result, billing_status, settlement_reason,
    COALESCE(amount::text, '')::text AS amount,
    currency, review_reason, state_version, created_at, updated_at, finalized_at
FROM task_run_provider_calls
WHERE
    task_run_id = $1
ORDER BY
    call_ordinal;

-- name: LockUsageRecord :one
SELECT
    task_run_id, tenant_id, workspace_id, project_id, run_type, resource_type, model_id, model_name,
    model_source, created_by, created_by_name, created_by_name_resolved_at, consumed_at, call_count,
    final_call_count, billing_status,
    COALESCE(total_amount::text, '')::text AS total_amount,
    currency, billing_attempts, no_progress_attempts, next_attempt_at, lease_owner, lease_until,
    state_version, review_reason, created_at, updated_at, billing_finalized_at
FROM project_usage_records
WHERE
    task_run_id = $1
FOR UPDATE;

-- name: UpdateUsageCall :execrows
UPDATE task_run_provider_calls
SET
    request_started_at = @request_started_at,
    request_id = @request_id,
    capture_result = @capture_result,
    billing_status = @billing_status,
    settlement_reason = @settlement_reason,
    amount = NULLIF(@amount::text, '')::numeric,
    currency = @currency,
    review_reason = @review_reason,
    state_version = @state_version,
    updated_at = @updated_at,
    finalized_at = @finalized_at
WHERE
    task_run_id = @id
    AND call_ordinal = @ordinal
    AND state_version = @expected_version;

-- name: PromoteUsageRecord :execrows
UPDATE project_usage_records
SET
    final_call_count = @final_call_count,
    billing_status = @billing_status,
    total_amount = NULLIF(@total_amount::text, '')::numeric,
    currency = @currency,
    no_progress_attempts = @no_progress_attempts,
    next_attempt_at = @next_attempt_at,
    lease_owner = @lease_owner,
    lease_until = @lease_until,
    review_reason = @review_reason,
    billing_finalized_at = @billing_finalized_at,
    state_version = @state_version,
    updated_at = @updated_at
WHERE
    task_run_id = @id
    AND state_version = @expected_version
    AND billing_status = @expected_status;

-- name: BeginUsageReconciliation :execrows
UPDATE project_usage_records
SET
    billing_attempts = @billing_attempts,
    no_progress_attempts = @no_progress_attempts,
    state_version = @state_version,
    updated_at = @updated_at
WHERE
    task_run_id = @id
    AND state_version = @expected_version
    AND billing_status = 'PENDING'
    AND lease_owner = @expected_owner
    AND lease_until > @updated_at;

-- name: FinishUsageReconciliation :execrows
UPDATE project_usage_records
SET
    final_call_count = @final_call_count,
    billing_status = @billing_status,
    total_amount = NULLIF(@total_amount::text, '')::numeric,
    currency = @currency,
    no_progress_attempts = @no_progress_attempts,
    next_attempt_at = @next_attempt_at,
    lease_owner = @lease_owner,
    lease_until = @lease_until,
    review_reason = @review_reason,
    billing_finalized_at = @billing_finalized_at,
    state_version = @state_version,
    updated_at = @updated_at,
    billing_attempts = @billing_attempts
WHERE
    task_run_id = @id
    AND state_version = @expected_version
    AND billing_status = 'PENDING'
    AND lease_owner = @expected_owner
    AND lease_until > @updated_at;

-- name: ClaimUsageBatch :many
WITH
    due AS (
        SELECT
            task_run_id
        FROM project_usage_records
        WHERE
            billing_status = 'PENDING'
            AND next_attempt_at <= @now::pg_catalog.timestamptz
            AND (
                lease_until IS NULL
                OR lease_until <= @now
            )
        ORDER BY
            next_attempt_at,
            task_run_id
        LIMIT
            @page_size::bigint
        FOR UPDATE
            SKIP LOCKED
    ),
    claimed AS (
        UPDATE project_usage_records r
        SET
            lease_owner = @owner,
            lease_until = @lease::pg_catalog.timestamptz,
            state_version = r.state_version + 1,
            updated_at = @now
        FROM due
        WHERE
            r.task_run_id = due.task_run_id
        RETURNING
            r.*
    )
SELECT
    task_run_id, tenant_id, workspace_id, project_id, run_type, resource_type, model_id, model_name,
    model_source, created_by, created_by_name, created_by_name_resolved_at, consumed_at, call_count,
    final_call_count, billing_status,
    COALESCE(total_amount::text, '')::text AS total_amount,
    currency, billing_attempts, no_progress_attempts, next_attempt_at, lease_owner, lease_until,
    state_version, review_reason, created_at, updated_at, billing_finalized_at
FROM claimed
ORDER BY
    next_attempt_at,
    task_run_id;

-- name: ClaimOneUsageRecord :one
UPDATE project_usage_records
SET
    lease_owner = @owner,
    lease_until = @lease::pg_catalog.timestamptz,
    state_version = state_version + 1,
    updated_at = @now
WHERE
    task_run_id = @id
    AND billing_status = 'PENDING'
    AND next_attempt_at <= @now::pg_catalog.timestamptz
    AND (
        lease_until IS NULL
        OR lease_until <= @now
    )
RETURNING
    task_run_id, tenant_id, workspace_id, project_id, run_type, resource_type, model_id, model_name,
    model_source, created_by, created_by_name, created_by_name_resolved_at, consumed_at, call_count,
    final_call_count, billing_status,
    COALESCE(total_amount::text, '')::text AS total_amount,
    currency, billing_attempts, no_progress_attempts, next_attempt_at, lease_owner, lease_until,
    state_version, review_reason, created_at, updated_at,
    billing_finalized_at;

-- name: ReadUsageNameTarget :one
SELECT
    task_run_id, tenant_id, created_by
FROM project_usage_records
WHERE
    created_by_name_resolved_at IS NULL
    AND task_run_id = $1;

-- name: ListUsageNameTargets :many
SELECT
    task_run_id, tenant_id, created_by
FROM project_usage_records
WHERE
    created_by_name_resolved_at IS NULL
ORDER BY
    created_at,
    task_run_id
LIMIT
    $1::bigint;

-- name: ResolveUsageUserName :exec
UPDATE project_usage_records
SET
    created_by_name = @name,
    created_by_name_resolved_at = @now::pg_catalog.timestamptz,
    updated_at = @now
WHERE
    task_run_id = @id
    AND tenant_id = @tenant_id
    AND created_by = @user_id
    AND created_by_name_resolved_at IS NULL;

-- name: ReadUsageProjectName :one
SELECT
    name
FROM projects
WHERE
    deleted_at = 0
    AND id = @project_id
    AND tenant_id = @tenant_id
    AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar;

-- name: ListUsageExportPage :many
SELECT
    task_run_id, tenant_id, workspace_id, project_id, run_type, resource_type, model_id, model_name,
    model_source, created_by, created_by_name, created_by_name_resolved_at, consumed_at, call_count,
    final_call_count, billing_status,
    COALESCE(total_amount::text, '')::text AS total_amount,
    currency, billing_attempts, no_progress_attempts, next_attempt_at, lease_owner, lease_until,
    state_version, review_reason, created_at, updated_at, billing_finalized_at
FROM project_usage_records
WHERE
    project_id = @project_id
    AND tenant_id = @tenant_id
    AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
    AND (
        sqlc.narg(after_time)::pg_catalog.timestamptz IS NULL
        OR (consumed_at, task_run_id) > (sqlc.narg(after_time), @after_id::varchar)
    )
ORDER BY
    consumed_at,
    task_run_id
LIMIT
    @page_size::bigint;
