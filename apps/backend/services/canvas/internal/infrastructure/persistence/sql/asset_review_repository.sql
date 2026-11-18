-- name: InsertAssetReview :exec
INSERT INTO asset_reviews (
    id, task_run_id, tenant_id, workspace_id, project_id, package_id, package_name, model_ids,
    system_preset_models, asset_id, provider_asset_id, reservation_id, status, failure_reason,
    submission_started_at, submitted_at, created_at, updated_at, deleted_at
) VALUES (
    sqlc.arg(id), sqlc.arg(task_run_id), sqlc.arg(tenant_id), sqlc.narg(workspace_id)::varchar,
    sqlc.arg(project_id), sqlc.arg(package_id), sqlc.arg(package_name), sqlc.arg(model_ids),
    sqlc.arg(system_preset_models), sqlc.arg(asset_id), sqlc.arg(provider_asset_id),
    sqlc.arg(reservation_id), sqlc.arg(status), sqlc.arg(failure_reason),
    sqlc.arg(submission_started_at), sqlc.arg(submitted_at), sqlc.arg(created_at),
    sqlc.arg(updated_at), 0
);

-- name: LockReviewsForReplacement :many
SELECT *
FROM asset_reviews
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND asset_id = sqlc.arg(asset_id)
  AND package_id = sqlc.arg(package_id)
ORDER BY created_at, id
FOR UPDATE;

-- name: RemoveReplacedReviews :exec
DELETE FROM asset_reviews
WHERE id = ANY(sqlc.arg(ids)::varchar[]::bpchar[]);

-- name: EnqueueReviewCleanup :exec
INSERT INTO asset_review_cleanup_outbox (
    review_id, asset_id, package_id, tenant_id, workspace_id, provider_asset_id, reservation_id,
    status, next_attempt_at, lease_until, state_version, attempts, last_error, created_at,
    updated_at
) VALUES (
    sqlc.arg(review_id), sqlc.arg(asset_id), sqlc.arg(package_id), sqlc.arg(tenant_id),
    sqlc.arg(workspace_id), sqlc.arg(provider_asset_id), sqlc.arg(reservation_id), sqlc.arg(status),
    sqlc.arg(next_attempt_at), sqlc.arg(lease_until), sqlc.arg(state_version), sqlc.arg(attempts),
    sqlc.arg(last_error), sqlc.arg(created_at), sqlc.arg(updated_at)
)
ON CONFLICT DO NOTHING;

-- name: ReserveReview :execrows
UPDATE asset_reviews
SET reservation_id = sqlc.arg(reservation_id),
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND deleted_at = 0
  AND status = 'SUBMITTING'
  AND reservation_id = '';

-- name: StartReviewSubmission :execrows
UPDATE asset_reviews
SET submission_started_at = sqlc.arg(updated_at)::pg_catalog.timestamptz,
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND deleted_at = 0
  AND status = 'SUBMITTING'
  AND task_run_id = sqlc.arg(task_run_id)
  AND submission_started_at IS NULL;

-- name: ResetReviewSubmission :execrows
UPDATE asset_reviews
SET submission_started_at = NULL,
    updated_at = sqlc.arg(updated_at),
    failure_reason = sqlc.arg(failure_reason)
WHERE id = sqlc.arg(id)
  AND deleted_at = 0
  AND status = 'SUBMITTING'
  AND task_run_id = sqlc.arg(task_run_id)
  AND submission_started_at IS NOT NULL;

-- name: ProcessReview :execrows
UPDATE asset_reviews
SET submitted_at = sqlc.arg(updated_at)::pg_catalog.timestamptz,
    status = 'PROCESSING',
    failure_reason = '',
    provider_asset_id = sqlc.arg(provider_asset_id),
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND deleted_at = 0
  AND status = 'SUBMITTING'
  AND task_run_id = sqlc.arg(task_run_id);

-- name: FailReview :execrows
UPDATE asset_reviews
SET status = 'FAILED',
    failure_reason = sqlc.arg(failure_reason),
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND deleted_at = 0
  AND status = 'SUBMITTING';

-- name: FinishReview :execrows
UPDATE asset_reviews
SET status = sqlc.arg(status),
    failure_reason = sqlc.arg(failure_reason),
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND deleted_at = 0
  AND status = 'PROCESSING';

-- name: ReadTaskAssetReview :one
SELECT *
FROM asset_reviews
WHERE deleted_at = 0
  AND task_run_id = $1;

-- name: LockRetiringReviews :many
SELECT *
FROM asset_reviews
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND asset_id = sqlc.arg(asset_id)
ORDER BY created_at, id
FOR UPDATE;

-- name: RetireReviews :exec
UPDATE asset_reviews
SET deleted_at = sqlc.arg(retired_at)::bigint,
    updated_at = sqlc.arg(updated_at)
WHERE id = ANY(sqlc.arg(ids)::varchar[]::bpchar[])
  AND deleted_at = 0;

-- name: ReadAssetReviews :many
SELECT *
FROM asset_reviews
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND asset_id = ANY(sqlc.arg(ids)::varchar[]::bpchar[])
  AND (sqlc.narg(project_id)::varchar IS NULL OR project_id = sqlc.narg(project_id))
ORDER BY created_at DESC, id DESC
LIMIT 200;

-- name: ClaimReviewCleanupJobs :many
WITH candidates AS (
    SELECT review_id
FROM asset_review_cleanup_outbox
WHERE status = 'pending'
  AND next_attempt_at <= sqlc.arg(now_ts)::pg_catalog.timestamptz
  AND (lease_until IS NULL OR lease_until <= sqlc.arg(now_ts))
ORDER BY next_attempt_at, review_id
LIMIT sqlc.arg(batch_size)::int
FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE asset_review_cleanup_outbox o SET lease_until = sqlc.arg(lease_end)::pg_catalog.timestamptz, state_version = o.state_version+1, updated_at = sqlc.arg(now_ts)
FROM candidates c
WHERE o.review_id = c.review_id RETURNING o.*
)
SELECT *
FROM claimed
ORDER BY next_attempt_at, review_id;

-- name: CompleteReviewCleanupJob :execrows
DELETE FROM asset_review_cleanup_outbox
WHERE review_id = sqlc.arg(review_id)
  AND state_version = sqlc.arg(state_version)
  AND status = 'pending'
  AND lease_until > sqlc.arg(now_ts)::pg_catalog.timestamptz;

-- name: RescheduleReviewCleanupJob :execrows
UPDATE asset_review_cleanup_outbox
SET next_attempt_at = sqlc.arg(next_attempt_at),
    lease_until = NULL,
    state_version = state_version+1,
    attempts = attempts+1,
    last_error = sqlc.arg(last_error),
    updated_at = sqlc.arg(now_ts)::pg_catalog.timestamptz
WHERE review_id = sqlc.arg(review_id)
  AND state_version = sqlc.arg(state_version)
  AND status = 'pending'
  AND lease_until > sqlc.arg(now_ts)::pg_catalog.timestamptz;

-- name: MarkReviewCleanupJobDead :execrows
UPDATE asset_review_cleanup_outbox
SET status = 'dead',
    lease_until = NULL,
    state_version = state_version+1,
    attempts = attempts+1,
    last_error = sqlc.arg(last_error),
    updated_at = sqlc.arg(now_ts)::pg_catalog.timestamptz
WHERE review_id = sqlc.arg(review_id)
  AND state_version = sqlc.arg(state_version)
  AND status = 'pending'
  AND lease_until > sqlc.arg(now_ts)::pg_catalog.timestamptz;
