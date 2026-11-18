-- name: InsertTaskRun :exec
INSERT INTO task_runs (
        id, tenant_id, workspace_id, created_by, run_type, subject_type, subject_id, is_internal, hidden_at,
        status, error_code, error_message, state_version, started_at, finished_at, created_at, updated_at,
        root_task_id, parent_task_id
    )
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19);

-- name: InsertAsyncDispatch :exec
INSERT INTO async_dispatches (
        task_run_id, run_type, delivery_state, execution_state, next_dispatch_at, publish_lease_until,
        execution_lease_until, execution_token, delivery_version, execution_version, publish_attempts,
        execution_attempts, execution_failures, lease_recoveries, first_started_at, last_error_code,
        last_error_message, created_at, updated_at
    )
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19);

-- name: InsertAsyncExecutionEvent :exec
INSERT INTO async_execution_events (
        id, task_run_id, run_type, execution_token, sequence, event_type, payload_version, payload,
        payload_sha256, terminal_slot, consume_status, next_consume_at, consume_lease_until, consume_attempts,
        state_version, last_error_code, last_error_message, created_at, updated_at, consumed_at
    )
VALUES
    (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
    );

-- name: InsertPollSchedule :exec
INSERT INTO poll_schedules (
        task_run_id, next_poll_at, lease_until, state_version, poll_attempts, consecutive_errors, deadline_at,
        created_at, updated_at
    )
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ReadTaskRun :one
SELECT
    *
FROM task_runs
WHERE
    id = $1;

-- name: LockTaskRun :one
SELECT
    *
FROM task_runs
WHERE
    id = $1
FOR UPDATE;

-- name: ReadVisibleTaskRun :one
SELECT
    *
FROM task_runs
WHERE
    tenant_id = @tenant_id
    AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
    AND NOT is_internal
    AND hidden_at IS NULL
    AND id = @id
    AND run_type = @run_type
    AND subject_type = @subject_type
    AND subject_id = @subject_id;

-- name: ListRootTaskRuns :many
SELECT
    *
FROM task_runs
WHERE
    tenant_id = @tenant_id
    AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
    AND COALESCE(root_task_id, id) = @related_id::varchar
ORDER BY
    created_at,
    id;

-- name: ListChildTaskRuns :many
SELECT
    *
FROM task_runs
WHERE
    tenant_id = @tenant_id
    AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
    AND parent_task_id = @related_id::varchar
ORDER BY
    created_at,
    id;

-- name: ReadTaskRunsByIDs :many
SELECT
    *
FROM task_runs
WHERE
    tenant_id = @tenant_id
    AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
    AND id = ANY (@ids::VARCHAR[])
    AND (
        NOT @visible_only::boolean
        OR (
            NOT is_internal
            AND hidden_at IS NULL
        )
    )
ORDER BY
    created_at,
    id;

-- name: ReadLatestTaskSubjects :many
SELECT DISTINCT
    ON (run_type, subject_type, subject_id) *
FROM task_runs
WHERE
    tenant_id = @tenant_id
    AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
    AND NOT is_internal
    AND hidden_at IS NULL
    AND (run_type, subject_type, subject_id) IN (
        SELECT
            unnest(@run_types::VARCHAR[]),
            unnest(@subject_types::VARCHAR[]),
            unnest(@subject_ids::VARCHAR[])
    )
ORDER BY
    run_type, subject_type, subject_id,
    created_at DESC,
    id DESC;

-- name: HasTaskChildren :one
SELECT
    EXISTS (
        SELECT
            1
        FROM task_runs
        WHERE
            parent_task_id = $1
    );

-- name: ChangeTaskRun :execrows
UPDATE task_runs
SET
    status = @status,
    error_message = @error_message,
    state_version = state_version + 1,
    updated_at = @updated_at,
    started_at = COALESCE(sqlc.narg(started_at)::pg_catalog.timestamptz, started_at),
    finished_at = COALESCE(sqlc.narg(finished_at)::pg_catalog.timestamptz, finished_at),
    error_code = COALESCE(NULLIF(@error_code::varchar, ''), error_code)
WHERE
    id = @id
    AND state_version = @state_version
    AND status IN ('queued', 'running', 'waiting_subtasks');

-- name: HideTaskRuns :exec
UPDATE task_runs
SET
    hidden_at = @now::pg_catalog.timestamptz,
    updated_at = @now,
    state_version = state_version + 1
WHERE
    tenant_id = @tenant_id
    AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
    AND run_type = @run_type
    AND subject_type = @subject_type
    AND subject_id = ANY (@subject_ids::VARCHAR[])
    AND hidden_at IS NULL;

-- name: ReadTaskRunType :one
SELECT
    run_type
FROM task_runs
WHERE
    id = $1;

-- name: ClaimPollSchedules :many
WITH
    due AS (
        SELECT
            p.task_run_id
        FROM poll_schedules p
            JOIN task_runs t ON t.id = p.task_run_id
        WHERE
            t.run_type = @run_type
            AND t.hidden_at IS NULL
            AND p.next_poll_at <= @now::pg_catalog.timestamptz
            AND (
                p.lease_until IS NULL
                OR p.lease_until <= @now
            )
        ORDER BY
            p.next_poll_at,
            p.task_run_id
        LIMIT
            @page_size::bigint
        FOR UPDATE OF
            p SKIP LOCKED
    ),
    claimed AS (
        UPDATE poll_schedules p
        SET
            lease_until = @lease::pg_catalog.timestamptz,
            state_version = p.state_version + 1,
            updated_at = @now
        FROM due
        WHERE
            p.task_run_id = due.task_run_id
        RETURNING
            p.*
    )
SELECT
    *
FROM claimed
ORDER BY
    next_poll_at,
    task_run_id;

-- name: RenewPollLease :execrows
UPDATE poll_schedules
SET
    lease_until = @lease::pg_catalog.timestamptz,
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND state_version = @version
    AND lease_until > @now;

-- name: ReschedulePoll :execrows
UPDATE poll_schedules
SET
    next_poll_at = @next_poll_at,
    lease_until = NULL,
    poll_attempts = @poll_attempts,
    consecutive_errors = @consecutive_errors,
    state_version = state_version + 1,
    updated_at = @now,
    deadline_at = COALESCE(sqlc.narg(deadline_at)::pg_catalog.timestamptz, deadline_at)
WHERE
    task_run_id = @id
    AND state_version = @version;

-- name: CompletePoll :execrows
DELETE FROM poll_schedules
WHERE
    task_run_id = @id
    AND state_version = @version;

-- name: DeletePoll :exec
DELETE FROM poll_schedules
WHERE
    task_run_id = $1;

-- name: DiscardTaskEvents :exec
UPDATE async_execution_events
SET
    consume_status = 'DISCARDED',
    consume_lease_until = NULL,
    consumed_at = @now::pg_catalog.timestamptz,
    updated_at = @now,
    state_version = state_version + 1
WHERE
    task_run_id = @id
    AND consume_status IN ('PENDING', 'CONSUMING');

-- name: DeleteTaskDispatch :exec
DELETE FROM async_dispatches
WHERE
    task_run_id = $1;

-- name: ReadTaskEvent :one
SELECT
    *
FROM async_execution_events
WHERE
    id = $1;

-- name: ReadTaskDispatch :one
SELECT
    *
FROM async_dispatches
WHERE
    task_run_id = $1;

-- name: HasEarlierTaskEvent :one
SELECT
    EXISTS (
        SELECT
            1
        FROM async_execution_events
        WHERE
            execution_token = @token
            AND sequence < @sequence
            AND consume_status NOT IN ('CONSUMED', 'DISCARDED')
    );

-- name: ClaimDueTaskEvents :many
WITH
    due AS (
        SELECT
            id
        FROM async_execution_events
        WHERE
            (
                consume_status = 'PENDING'
                AND next_consume_at <= @now::pg_catalog.timestamptz
            )
            OR (
                consume_status = 'CONSUMING'
                AND consume_lease_until <= @now
            )
        ORDER BY
            next_consume_at,
            id
        LIMIT
            @page_size::bigint
        FOR UPDATE
            SKIP LOCKED
    ),
    claimed AS (
        UPDATE async_execution_events e
        SET
            consume_status = 'CONSUMING',
            consume_lease_until = @lease::pg_catalog.timestamptz,
            consume_attempts = e.consume_attempts + 1,
            state_version = e.state_version + 1,
            updated_at = @now
        FROM due
        WHERE
            e.id = due.id
        RETURNING
            e.*
    )
SELECT
    *
FROM claimed
ORDER BY
    next_consume_at,
    id;

-- name: FinishTaskEvent :execrows
UPDATE async_execution_events
SET
    consume_status = @status,
    consume_lease_until = NULL,
    state_version = state_version + 1,
    updated_at = @now::pg_catalog.timestamptz,
    consumed_at = @now
WHERE
    id = @id
    AND state_version = @version
    AND consume_status = 'CONSUMING';

-- name: RetryTaskEvent :execrows
UPDATE async_execution_events
SET
    consume_status = 'PENDING',
    next_consume_at = @due,
    consume_lease_until = NULL,
    state_version = state_version + 1,
    last_error_code = @code,
    last_error_message = @message,
    updated_at = @now,
    consumed_at = NULL
WHERE
    id = @id
    AND state_version = @version
    AND consume_status = 'CONSUMING';

-- name: DueTaskDispatches :many
SELECT
    *
FROM async_dispatches
WHERE
    (
        execution_state = 'WAITING'
        AND next_dispatch_at <= @now::pg_catalog.timestamptz
        AND (
            publish_lease_until IS NULL
            OR publish_lease_until <= @now
        )
    )
    OR (
        execution_state = 'FAILURE_PENDING'
        AND next_dispatch_at <= @now::pg_catalog.timestamptz
        AND (
            execution_lease_until IS NULL
            OR execution_lease_until <= @now
        )
    )
    OR (
        execution_state = 'EXECUTING'
        AND execution_lease_until <= @now::pg_catalog.timestamptz
    )
ORDER BY
    next_dispatch_at,
    task_run_id
LIMIT
    @page_size::bigint;

-- name: ClaimWaitingDispatch :one
UPDATE async_dispatches
SET
    publish_lease_until = @lease::pg_catalog.timestamptz,
    delivery_version = delivery_version + 1,
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND delivery_version = @version
    AND execution_state = 'WAITING'
    AND next_dispatch_at <= @now::pg_catalog.timestamptz
    AND (
        publish_lease_until IS NULL
        OR publish_lease_until <= @now
    )
RETURNING
    *;

-- name: ClaimFailureDispatch :one
UPDATE async_dispatches
SET
    execution_lease_until = @lease::pg_catalog.timestamptz,
    execution_version = execution_version + 1,
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND execution_version = @version
    AND execution_state = 'FAILURE_PENDING'
    AND next_dispatch_at <= @now::pg_catalog.timestamptz
    AND (
        execution_lease_until IS NULL
        OR execution_lease_until <= @now
    )
RETURNING
    *;

-- name: LockExpiredDispatch :one
SELECT
    *
FROM async_dispatches
WHERE
    task_run_id = @id
    AND execution_version = @version
    AND execution_state = 'EXECUTING'
    AND execution_lease_until <= @now::pg_catalog.timestamptz
FOR UPDATE;

-- name: ReadTerminalEvent :one
SELECT
    *
FROM async_execution_events
WHERE
    execution_token = $1
    AND terminal_slot = 1;

-- name: CompleteExpiredDispatch :exec
DELETE FROM async_dispatches
WHERE
    task_run_id = @id
    AND execution_version = @version
    AND execution_state = 'EXECUTING';

-- name: ExpediteTerminalEvent :exec
UPDATE async_execution_events
SET
    next_consume_at = @now,
    updated_at = @now
WHERE
    id = @id
    AND consume_status = 'PENDING';

-- name: ExpeditePendingEvents :exec
UPDATE async_execution_events
SET
    next_consume_at = @now,
    updated_at = @now
WHERE
    execution_token = @token
    AND consume_status = 'PENDING';

-- name: HasUnfinishedTaskEvents :one
SELECT
    EXISTS (
        SELECT
            1
        FROM async_execution_events
        WHERE
            execution_token = $1
            AND consume_status IN ('PENDING', 'CONSUMING')
    );

-- name: RecoverExpiredDispatch :one
UPDATE async_dispatches
SET
    delivery_state = 'PENDING',
    delivery_version = delivery_version + 1,
    execution_state = @state,
    execution_lease_until = sqlc.narg(execution_lease_until),
    publish_lease_until = sqlc.narg(publish_lease_until),
    execution_token = '',
    lease_recoveries = lease_recoveries + 1,
    execution_version = execution_version + 1,
    last_error_code = @code,
    last_error_message = @message,
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND execution_version = @version
    AND execution_state = 'EXECUTING'
RETURNING
    *;

-- name: RescheduleTaskDispatch :one
UPDATE async_dispatches
SET
    next_dispatch_at = @due,
    publish_lease_until = NULL,
    publish_attempts = publish_attempts + 1,
    last_error_code = @code,
    last_error_message = @message,
    delivery_version = delivery_version + 1,
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND delivery_version = @version
RETURNING
    *;

-- name: DeliverTaskDispatch :one
UPDATE async_dispatches
SET
    delivery_state = 'DELIVERED',
    next_dispatch_at = @due,
    publish_lease_until = NULL,
    publish_attempts = publish_attempts + 1,
    delivery_version = delivery_version + 1,
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND delivery_version = @version
RETURNING
    *;

-- name: FailTaskDispatch :one
UPDATE async_dispatches
SET
    execution_state = 'FAILURE_PENDING',
    execution_lease_until = publish_lease_until,
    publish_lease_until = NULL,
    last_error_code = @code,
    last_error_message = @message,
    delivery_version = delivery_version + 1,
    execution_version = execution_version + 1,
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND delivery_version = @version
    AND execution_version = @execution_version
    AND execution_state = 'WAITING'
RETURNING
    *;

-- name: StartTaskExecution :one
UPDATE async_dispatches
SET
    execution_state = 'EXECUTING',
    execution_lease_until = @lease::pg_catalog.timestamptz,
    execution_attempts = execution_attempts + 1,
    execution_token = @token,
    execution_version = execution_version + 1,
    first_started_at = COALESCE(first_started_at, @now::pg_catalog.timestamptz),
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND execution_state = 'WAITING'
    AND (
        delivery_state = 'DELIVERED'
        OR publish_lease_until > @now
    )
RETURNING
    *;

-- name: RenewTaskExecution :one
UPDATE async_dispatches
SET
    execution_lease_until = @lease::pg_catalog.timestamptz,
    execution_version = execution_version + 1,
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND execution_version = @version
    AND execution_state = 'EXECUTING'
    AND execution_token = @token
RETURNING
    *;

-- name: ReleaseTaskExecution :one
UPDATE async_dispatches
SET
    delivery_state = 'PENDING',
    next_dispatch_at = @due,
    publish_lease_until = NULL,
    delivery_version = delivery_version + 1,
    execution_state = 'WAITING',
    execution_lease_until = NULL,
    execution_token = '',
    execution_failures = execution_failures + @failures::integer,
    last_error_code = @code,
    last_error_message = @message,
    execution_version = execution_version + 1,
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND execution_version = @version
    AND execution_state = 'EXECUTING'
    AND execution_token = @token
RETURNING
    *;

-- name: AdvanceTaskExecution :one
UPDATE async_dispatches
SET
    execution_version = execution_version + 1,
    updated_at = @now::pg_catalog.timestamptz
WHERE
    task_run_id = @id
    AND execution_version = @version
    AND execution_state = 'EXECUTING'
    AND execution_token = @token
RETURNING
    *;

-- name: FinishTaskExecution :execrows
DELETE FROM async_dispatches
WHERE
    task_run_id = @id
    AND execution_version = @version
    AND execution_state IN ('EXECUTING', 'FAILURE_PENDING');

-- name: LockActiveCanvasNode :one
SELECT
    n.id
FROM canvas_nodes n
    JOIN canvases c ON c.id = n.canvas_id
    AND c.project_id = n.project_id
    AND c.deleted_at = 0
    JOIN projects p ON p.id = n.project_id
    AND p.deleted_at = 0
WHERE
    n.id = @id
    AND n.deleted_at = 0
    AND n.tenant_id = @tenant_id
    AND n.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
LIMIT
    1
FOR SHARE;

-- name: LockActiveTaskCanvas :one
SELECT
    c.id
FROM canvases c
    JOIN projects p ON p.id = c.project_id
    AND p.deleted_at = 0
WHERE
    c.id = @id
    AND c.deleted_at = 0
    AND c.tenant_id = @tenant_id
    AND c.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
LIMIT
    1
FOR SHARE;

-- name: LockActiveTaskDraft :one
SELECT
    res.id
FROM resource_assets ra
    JOIN resources res ON res.id = ra.resource_id
    AND ra.deleted_at = 0
    JOIN projects p ON p.id = res.owner_id
    AND res.owner_type = 1
    AND p.deleted_at = 0
WHERE
    ra.image_generation_draft_id = @id
    AND res.deleted_at = 0
    AND res.tenant_id = @tenant_id
    AND res.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
LIMIT
    1
FOR SHARE;

-- name: LockActiveTaskProject :one
SELECT
    p.id
FROM projects p
WHERE
    p.id = @id
    AND p.deleted_at = 0
    AND p.tenant_id = @tenant_id
    AND p.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
LIMIT
    1
FOR SHARE;

-- name: LockActiveTaskResource :one
SELECT
    res.id
FROM resources res
    JOIN projects p ON p.id = res.owner_id
    AND res.owner_type = 1
    AND p.deleted_at = 0
WHERE
    res.id = @id
    AND res.deleted_at = 0
    AND res.tenant_id = @tenant_id
    AND res.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
LIMIT
    1
FOR SHARE;

-- name: ReadTaskTarget :one
SELECT
    target_id,
    target_type
FROM image_generation_runs
WHERE
    task_run_id = @id
    AND tenant_id = @tenant_id
    AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar;

-- name: ReadTaskAssetOwner :one
SELECT
    owner_id,
    owner_type
FROM assets
WHERE
    id = @id
    AND deleted_at = 0
    AND tenant_id = @tenant_id
    AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar;
