-- Persist the conversion provider choice so durable task recovery preserves the
-- user's selected vision model. Reset legacy in-process states: Executor owns
-- active work from this version onward and safely deduplicates by content revision.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS conversion_provider_id varchar(32) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS processing_dispatched_at timestamptz DEFAULT NULL;

UPDATE documents
SET ingest_status = 'received'
WHERE kind = 'source' AND ingest_status = 'converting';

UPDATE documents
SET index_status = 'pending'
WHERE kind = 'source' AND ingest_status = 'ready' AND index_status = 'indexing';

CREATE INDEX IF NOT EXISTS ix_documents_processing_intent
  ON documents (processing_dispatched_at ASC NULLS FIRST, updated_at, id)
  WHERE kind = 'source'
    AND (
      ingest_status IN ('received', 'converting')
      OR (ingest_status = 'ready' AND index_status IN ('pending', 'indexing'))
    );
