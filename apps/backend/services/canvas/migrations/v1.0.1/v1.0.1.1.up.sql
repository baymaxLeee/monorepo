-- Move unfinished archive exports from the retired Executor bridge onto the
-- Canvas-owned async dispatch queue. The legacy row is retained for rollback;
-- task execution and output publication are idempotent by task_run_id.
INSERT INTO public.async_dispatches (
    task_run_id,
    run_type,
    delivery_state,
    execution_state,
    next_dispatch_at,
    publish_lease_until,
    execution_lease_until,
    execution_token,
    delivery_version,
    execution_version,
    publish_attempts,
    execution_attempts,
    execution_failures,
    lease_recoveries,
    first_started_at,
    last_error_code,
    last_error_message,
    created_at,
    updated_at
)
SELECT
    workflow.task_run_id,
    'CANVAS_VIDEO_ARCHIVE_EXPORT',
    'PENDING',
    'WAITING',
    CURRENT_TIMESTAMP,
    NULL,
    NULL,
    '',
    1,
    1,
    0,
    0,
    0,
    0,
    NULL,
    '',
    '',
    workflow.created_at,
    CURRENT_TIMESTAMP
FROM public.canvas_archive_workflows AS workflow
JOIN public.task_runs AS task_run ON task_run.id = workflow.task_run_id
WHERE workflow.settled = false
  AND workflow.cancel_requested = false
  AND task_run.run_type = 'CANVAS_VIDEO_ARCHIVE_EXPORT'
  AND task_run.status IN ('queued', 'running')
ON CONFLICT (task_run_id) DO NOTHING;
