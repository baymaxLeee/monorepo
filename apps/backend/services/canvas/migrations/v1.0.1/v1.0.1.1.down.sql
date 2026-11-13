DELETE FROM public.async_dispatches AS dispatch
USING public.canvas_archive_workflows AS workflow
WHERE dispatch.task_run_id = workflow.task_run_id
  AND workflow.settled = false
  AND dispatch.run_type = 'CANVAS_VIDEO_ARCHIVE_EXPORT';
