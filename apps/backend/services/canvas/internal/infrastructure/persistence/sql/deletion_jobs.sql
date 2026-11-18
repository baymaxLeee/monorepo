-- name: ClaimDeletionJobs :many
WITH due AS (
    SELECT id FROM deletion_jobs
    WHERE completed_at IS NULL AND next_attempt_at <= sqlc.arg(claim_time)::pg_catalog.timestamptz
      AND (lease_until IS NULL OR lease_until <= sqlc.arg(claim_time))
    ORDER BY next_attempt_at, id
    LIMIT sqlc.arg(batch_size)::bigint
    FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE deletion_jobs AS j
    SET lease_until = sqlc.arg(lease_until)::pg_catalog.timestamptz, state_version = j.state_version + 1,
        updated_at = now()
    FROM due WHERE j.id = due.id
    RETURNING j.id, j.tenant_id, j.kind, j.payload, j.attempts, j.state_version, j.next_attempt_at
)
SELECT id, tenant_id, kind, payload, attempts, state_version
FROM claimed ORDER BY next_attempt_at, id;

-- name: FinishDeletionJob :execrows
UPDATE deletion_jobs
SET lease_until = NULL, state_version = state_version + 1, attempts = attempts + 1,
    last_error = '', completed_at = sqlc.arg(finish_time)::pg_catalog.timestamptz, updated_at = now()
WHERE id = sqlc.arg(id) AND state_version = sqlc.arg(state_version)
  AND completed_at IS NULL AND lease_until > sqlc.arg(finish_time);

-- name: RetryDeletionJob :execrows
UPDATE deletion_jobs
SET lease_until = NULL, state_version = state_version + 1, attempts = attempts + 1,
    last_error = 'deletion effect failed; retry pending',
    next_attempt_at = sqlc.arg(next_attempt_at), updated_at = now()
WHERE id = sqlc.arg(id) AND state_version = sqlc.arg(state_version)
  AND completed_at IS NULL AND lease_until > sqlc.arg(finish_time)::pg_catalog.timestamptz;
