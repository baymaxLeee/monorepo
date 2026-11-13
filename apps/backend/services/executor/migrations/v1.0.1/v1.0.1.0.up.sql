-- Knowledge now processes source documents synchronously inside its own request.
-- Retire old bridge tasks so persisted projections do not remain queued/running
-- after the workflow implementation and dispatcher are removed.
UPDATE public.tasks
SET status = 'cancelled',
    error = COALESCE(error, 'Knowledge document processing moved into the Knowledge service'),
    cleanup_pending = false,
    finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE type = 'knowledge-document-process'
  AND status IN ('queued', 'running');
