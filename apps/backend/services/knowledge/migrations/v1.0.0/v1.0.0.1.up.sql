CREATE INDEX ix_document_chunks_contextualized_content_trgm
    ON public.document_chunks USING gin (contextualized_content public.gin_trgm_ops);

CREATE INDEX ix_document_chunks_retrieval_scope
    ON public.document_chunks USING btree (tenant_id, workspace_id, embed_model);

-- Existing chunks remain searchable while the normal idempotent processing path
-- rebuilds them with the current chunking/contextual-index rules on the next
-- document read or explicit reindex. External model calls never run in DDL.
UPDATE public.documents
SET index_status = 'pending', index_error = NULL
WHERE kind = 'source' AND ingest_status = 'ready';
