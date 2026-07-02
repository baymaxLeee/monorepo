-- Knowledge service baseline schema (PostgreSQL + pgvector).
--
-- Knowledge moved from MySQL to the shared Postgres instance so documents,
-- chunks, and RAG vectors live in one database. This is a fresh PG baseline
-- that matches the current SQLAlchemy models (documents + artifact tables) and
-- adds the RAG `document_chunks` table. Demo phase: prior MySQL knowledge data
-- is not migrated (documents are re-ingested).

CREATE EXTENSION IF NOT EXISTS vector;

-- Business documents: source uploads + agent artifacts (per user).
CREATE TABLE IF NOT EXISTS documents (
  id varchar(32) NOT NULL,
  user_id varchar(26) NOT NULL,
  conversation_id varchar(32) NULL,
  kind varchar(20) NOT NULL,
  title varchar(255) NOT NULL,
  filename varchar(255) NOT NULL,
  mime_type varchar(120) NOT NULL DEFAULT 'text/markdown',
  content_md text NOT NULL,
  source_size integer NOT NULL DEFAULT 0,
  source_mime_type varchar(120) NULL,
  object_bucket varchar(64) NULL,
  object_key varchar(512) NULL,
  object_sha256 varchar(64) NULL,
  source_filename varchar(255) NULL,
  ingest_status varchar(20) NOT NULL DEFAULT 'ready',
  ingest_progress integer NOT NULL DEFAULT 100,
  ingest_error text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS ix_documents_user_id ON documents (user_id);
CREATE INDEX IF NOT EXISTS ix_documents_conversation_id ON documents (conversation_id);
CREATE INDEX IF NOT EXISTS ix_documents_kind ON documents (kind);

-- Durable artifact generation state (written by the executor service).
CREATE TABLE IF NOT EXISTS artifact_generations (
  id varchar(32) NOT NULL,
  document_id varchar(32) NOT NULL,
  user_id varchar(26) NOT NULL,
  conversation_id varchar(32) NULL,
  kind varchar(20) NOT NULL,
  title varchar(255) NOT NULL,
  filename varchar(255) NOT NULL,
  brief text NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  base_revision_id varchar(32) NULL,
  attempt integer NOT NULL DEFAULT 1,
  run_id varchar(32) NULL,
  tool_call_id varchar(64) NULL,
  status varchar(24) NOT NULL,
  phase varchar(32) NOT NULL,
  manifest_json jsonb NULL,
  total_blocks integer NOT NULL DEFAULT 0,
  completed_blocks integer NOT NULL DEFAULT 0,
  failed_blocks integer NOT NULL DEFAULT 0,
  error text NULL,
  lease_owner varchar(128) NULL,
  lease_expires_at timestamptz NULL,
  started_at timestamptz NULL,
  cancel_requested_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  PRIMARY KEY (id),
  CONSTRAINT ux_artifact_generations_idempotency UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_artifact_generations_document_id ON artifact_generations (document_id);
CREATE INDEX IF NOT EXISTS ix_artifact_generations_user_id ON artifact_generations (user_id);
CREATE INDEX IF NOT EXISTS ix_artifact_generations_run_id ON artifact_generations (run_id);

CREATE TABLE IF NOT EXISTS artifact_block_versions (
  id varchar(32) NOT NULL,
  document_id varchar(32) NOT NULL,
  generation_id varchar(32) NOT NULL,
  block_id varchar(80) NOT NULL,
  block_type varchar(40) NOT NULL,
  position integer NOT NULL,
  brief text NOT NULL,
  status varchar(24) NOT NULL,
  object_bucket varchar(64) NULL,
  object_key varchar(512) NULL,
  object_sha256 varchar(64) NULL,
  content_size bigint NOT NULL DEFAULT 0,
  error text NULL,
  attempt integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT ux_artifact_block_generation_id UNIQUE (generation_id, block_id)
);
CREATE INDEX IF NOT EXISTS ix_artifact_blocks_document_id ON artifact_block_versions (document_id);
CREATE INDEX IF NOT EXISTS ix_artifact_blocks_generation_id ON artifact_block_versions (generation_id);

CREATE TABLE IF NOT EXISTS artifact_revisions (
  id varchar(32) NOT NULL,
  document_id varchar(32) NOT NULL,
  parent_revision_id varchar(32) NULL,
  generation_id varchar(32) NOT NULL,
  manifest_json jsonb NOT NULL,
  object_bucket varchar(64) NOT NULL,
  object_key varchar(512) NOT NULL,
  object_sha256 varchar(64) NOT NULL,
  content_size bigint NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT ux_artifact_revisions_generation_id UNIQUE (generation_id)
);
CREATE INDEX IF NOT EXISTS ix_artifact_revisions_document_id ON artifact_revisions (document_id);

-- RAG chunks: dense vector (pgvector) + sparse BM25 (tsvector) for hybrid search.
-- `embedding vector(1536)` must match Settings.embedding_dim; changing the
-- embedding model/dimension requires altering this column and re-indexing.
-- `tsv` is DB-maintained (GENERATED) so the app never writes it.
CREATE TABLE IF NOT EXISTS document_chunks (
  id varchar(32) NOT NULL,
  document_id varchar(32) NOT NULL,
  user_id varchar(26) NOT NULL,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  contextualized_content text NULL,
  embedding vector(1536) NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  token_count integer NOT NULL DEFAULT 0,
  embed_model varchar(120) NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT ux_document_chunks_doc_index UNIQUE (document_id, chunk_index),
  CONSTRAINT fk_document_chunks_document
    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_document_chunks_user_id ON document_chunks (user_id);
CREATE INDEX IF NOT EXISTS ix_document_chunks_document_id ON document_chunks (document_id);
CREATE INDEX IF NOT EXISTS ix_document_chunks_tsv ON document_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

UPDATE migration SET version = 'v1.0.0', update_time = NOW() WHERE id = 1;
