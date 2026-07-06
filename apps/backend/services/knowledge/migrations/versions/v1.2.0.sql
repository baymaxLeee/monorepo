-- Knowledge RAG: CJK-friendly sparse retrieval via pg_trgm (replaces `simple` FTS).
--
-- v1.0.0 built the sparse side as `tsv = to_tsvector('simple', content)`. The
-- `simple` config does not segment CJK, so for Chinese queries the sparse branch
-- matched almost nothing and hybrid retrieval silently collapsed to dense-only.
-- This corpus is small and mostly Chinese, so instead of a heavyweight word-level
-- segmenter (zhparser needs a custom image) we switch the sparse branch to pg_trgm
-- character-trigram matching (`word_similarity`), which needs no image change and
-- is GIN-accelerated. Dense (v1.1.0 halfvec HNSW) + this sparse branch are still
-- fused by RRF + rerank in services/retrieval.py.
--
-- Future-first: the dead `simple` tsvector column and its GIN index are dropped
-- rather than left behind; crud/chunks.py `sparse_search` now uses pg_trgm.

-- No-op under the non-superuser `knowledge` role: db-migrate.sh pre-installs
-- pg_trgm as the admin superuser before migrations run.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS ix_document_chunks_tsv;
ALTER TABLE document_chunks DROP COLUMN IF EXISTS tsv;

CREATE INDEX IF NOT EXISTS ix_document_chunks_content_trgm
  ON document_chunks USING gin (content gin_trgm_ops);

UPDATE migration SET version = 'v1.2.0', update_time = NOW() WHERE id = 1;
