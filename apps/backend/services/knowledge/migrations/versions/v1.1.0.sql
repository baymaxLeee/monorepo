-- Knowledge RAG: add an ANN index for dense retrieval (halfvec HNSW).
--
-- Supersedes the v1.0.0 note that "no ANN index is possible because
-- doubao-embedding-text is 2048-dim and pgvector caps HNSW/IVFFlat at 2000":
-- since pgvector 0.7 the `halfvec` (16-bit) type indexes up to 4000 dims, so a
-- 2048-dim embedding is fully indexable. We keep the full-precision
-- `vector(2048)` column for storage/scoring and build the HNSW graph on its
-- `halfvec(2048)` cast (half-precision indexing): graph storage roughly halves,
-- recall stays effectively unchanged, and dense search stops being an exact
-- sequential scan over each user's chunks.
--
-- IMPORTANT: the dense query in crud/chunks.py MUST order by the SAME expression
--   embedding::halfvec(2048) <=> $q::halfvec(2048)
-- (identical cast + halfvec_cosine_ops) or the planner will not use this index.

CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_hnsw
  ON document_chunks
  USING hnsw ((embedding::halfvec(2048)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

UPDATE migration SET version = 'v1.1.0', update_time = NOW() WHERE id = 1;
