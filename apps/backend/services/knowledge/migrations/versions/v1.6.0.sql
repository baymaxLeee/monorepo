-- v1.6.0: decouple RAG indexing from ingest progress. Import/edit now returns as
-- soon as the document is stored + converted (ready/100); embedding + chunking run
-- asynchronously in the background. index_status tracks that async lifecycle
-- separately from ingest_status so it is observable and retryable.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS index_status varchar(20) NOT NULL DEFAULT 'skipped';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS index_error text;

-- Backfill by real chunk existence, not assumption: the old ingest swallowed
-- indexing errors and still emitted file_ready, so a source doc may have no
-- chunks. Docs with chunks are already indexed; source docs with content but no
-- chunks are re-queued (pending) for the startup sweep; everything else (empty
-- docs, agent artifacts) is not part of RAG (skipped).
UPDATE documents d SET index_status = CASE
  WHEN EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id) THEN 'indexed'
  WHEN d.kind = 'source' AND length(coalesce(d.content_md, '')) > 0 THEN 'pending'
  ELSE 'skipped'
END;

UPDATE migration SET version = 'v1.6.0', update_time = NOW() WHERE id = 1;
