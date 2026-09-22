DELETE FROM public.poll_schedules
WHERE task_run_id IN (
    SELECT id
    FROM public.task_runs
    WHERE run_type = 'CANVAS_STORYBOARD_GENERATION'
      AND subject_type = 'CANVAS'
);

UPDATE public.task_run_provider_calls
SET capture_result = 'NOT_SENT',
    billing_status = 'FINAL',
    settlement_reason = 'NOT_SENT',
    amount = 0,
    review_reason = '',
    state_version = state_version + 1,
    finalized_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE task_run_id IN (
    SELECT id
    FROM public.task_runs
    WHERE run_type = 'CANVAS_STORYBOARD_GENERATION'
      AND subject_type = 'CANVAS'
)
  AND billing_status = 'PENDING'
  AND request_started_at IS NULL;

UPDATE public.task_run_provider_calls
SET capture_result = 'REQUEST_ID_UNKNOWN',
    billing_status = 'NEEDS_REVIEW',
    review_reason = 'legacy storyboard task removed during canvas-node unification',
    state_version = state_version + 1,
    finalized_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE task_run_id IN (
    SELECT id
    FROM public.task_runs
    WHERE run_type = 'CANVAS_STORYBOARD_GENERATION'
      AND subject_type = 'CANVAS'
)
  AND billing_status = 'PENDING'
  AND request_started_at IS NOT NULL
  AND capture_result IS NULL;

UPDATE public.task_runs
SET status = 'cancelled',
    error_code = '',
    error_message = '',
    hidden_at = COALESCE(hidden_at, CURRENT_TIMESTAMP),
    finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
    state_version = state_version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE run_type = 'CANVAS_STORYBOARD_GENERATION'
  AND subject_type = 'CANVAS'
  AND status IN ('queued', 'running');

DROP TABLE IF EXISTS public.canvas_storyboard_drafts;
