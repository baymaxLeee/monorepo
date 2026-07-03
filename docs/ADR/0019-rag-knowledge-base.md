# ADR 0019: Enterprise RAG knowledge base (retrieval in knowledge, generation in chat)

## Status

Accepted.

## Context

The `knowledge` service (ADR-0004) only did ingest -> MarkItDown conversion ->
object storage + artifacts. Chat's only "retrieval" was `list_files` /
`read_file` by id, scoped to the current conversation's attachments — not
semantic search over a persistent knowledge base. The product needs
enterprise-grade knowledge-base QA in chat: upload documents, then ask
questions and get accurate, timely, cited answers.

The stack decision was grounded in current (2026) practice, not memory:

- Retrieval is the bottleneck; naive pure-vector search fails ~40% of the time.
  The production reference stack is hybrid retrieval (dense + BM25) fused with
  Reciprocal Rank Fusion (RRF, k=60), a cross-encoder rerank, and Anthropic's
  Contextual Retrieval (prepend a 50-100 token document-aware context to each
  chunk before embedding/indexing — the single highest-ROI accuracy lever).
- Python owns the RAG ecosystem; scale lives in the vector store, not the app
  language, so knowledge stays Python (ADR-0004 verdict re-confirmed).
- `pgvector` is the 2026 default starting vector store for teams already running
  Postgres — which this repo does (executor's Workflow World).

## Decision

1. **Split of responsibility.** Retrieval lives in `knowledge` (Python);
   generation stays in chat's `ToolLoopAgent` (ADR-0011). Chat consumes
   retrieval through a `search_knowledge` tool -> knowledge
   `POST /internal/retrieve`. No second agent runtime is built in Python.

2. **knowledge moves to the shared Postgres instance** (documents + chunks +
   vectors in one DB). The docker-compose `workflow-postgres` service image
   becomes `pgvector/pgvector:pg16` and now hosts two databases (`workflow` for
   executor, `knowledge` for this service) — one instance, many databases. A
   `migrations/engine` marker (`postgres`) routes the service through a new
   Postgres branch in `scripts/db-migrate.sh`; the MySQL bootstrap skips it and
   `just up` migrates it after Postgres is ready. Full MySQL->PG consolidation
   of the other services is deliberately out of scope (a separate later task);
   knowledge is the pilot. Demo phase: prior MySQL knowledge data is not
   migrated (documents are re-ingested).

3. **Indexing pipeline** (`services/indexing.py`): `content_md` -> recursive
   ~512-token chunking -> optional Contextual Retrieval (a cheap chat-model call
   per chunk, bounded concurrency, best-effort) -> embeddings -> `document_chunks`
   (`embedding vector(2048)` = doubao-embedding-text dim, + a DB-`GENERATED`
   `tsv tsvector`). It fully
   replaces a document's chunks on each run.

4. **Timeliness (时效性) is structural.** Re-index on document change (ingest
   and the public document-edit route call `index_document`); delete is handled
   by a `document_chunks -> documents` FK `ON DELETE CASCADE`. "Current public"
   questions route to `web_search`, not the KB (enforced by the agent prompt).

5. **Retrieval** (`services/retrieval.py`): embed the query -> dense ANN
   (`embedding <=> q`) + sparse BM25 (`websearch_to_tsquery` over `tsv`), each
   overfetched to `retrieval_candidate_k` -> RRF(k=60) fuse -> optional
   cross-encoder rerank -> top_k. Every result is filtered by `user_id` (ACL)
   and carries its source document title/filename for citation.

6. **Embeddings + rerank are API-only** (no torch), resolved per-user from
   admin. `provider_kind` gains `embedding` and `rerank`; knowledge fetches the
   user's provider via a new admin internal route
   `GET /internal/providers/by-kind/{kind}` (non-chat kinds have no default
   flag, so it returns the newest enabled provider of that kind). Missing
   embedding provider degrades retrieval to sparse-only; missing/failing rerank
   degrades to RRF order; both never fail the request.

## Consequences

- New knowledge deps: `asyncpg`, `pgvector` (replaced `asyncmy`). New tables:
  `document_chunks` (GIN on `tsv` for sparse; the dense side originally shipped
  with no ANN index — corrected in the v1.1.0 update below). `documents` and
  the artifact tables are reproduced faithfully as a fresh PG baseline
  (`v1.0.0.sql`), which also fixes prior MySQL-migration/model drift.
- Embedding model and the `vector(2048)` column must agree; changing the
  embedding model/dimension requires altering the column and re-indexing
  (`embed_model` is stored per chunk to detect drift).
- Chinese sparse retrieval uses pg_trgm character-trigram `word_similarity`
  (v1.2.0), not the `simple` FTS config (which does not segment CJK). Word-level
  `zhparser`/`pg_jieba` remains a heavier later upgrade if precision demands it.
- Artifact auto-indexing and a standalone knowledge-base MFE are out of scope for
  the MVP; only ingest + public document edits index today.
- Cross-stack contract regenerated: `knowledge-server.json` / `admin-server.json`
  OpenAPI + `@backend/transport-ts` (`KnowledgeInternalClient.retrieve`).

## Alternatives considered

- Dual engine (documents in MySQL + a separate PG for vectors): rejected — it
  makes knowledge straddle two SQL engines for no benefit.
- Dedicated vector DB (Qdrant/Milvus) now: rejected for the MVP — pgvector on an
  instance we already operate is lighter; migrate when a real scale/filter cliff
  appears (documented threshold: >10-50M vectors or heavy payload filtering).
- Self-hosted embedding/reranker (BGE-M3): rejected for the MVP to avoid torch /
  GPU; the API path is a drop-in and the provider abstraction already exists.
- Generating answers inside knowledge: rejected — it would duplicate the agent
  runtime ADR-0011 keeps single and in TypeScript.

## Verification

Static (done): `ruff` + `mypy` clean for knowledge and admin; `tsc` clean for
chat; OpenAPI + transport-ts regenerated. Runtime (manual, requires `just up`):
upload -> auto-index -> `search_knowledge` in chat returns cited passages;
edit/delete a document and confirm retrieval reflects it. A lightweight,
manual-only retrieval quality script lives at
`apps/backend/services/knowledge/scripts/eval_rag.py` (not CI, not pytest — the
demo-phase test ban still holds).

## Update — v1.1.0: dense ANN index (halfvec HNSW)

The v1.0.0 claim that "no ANN index is possible because the embedding is 2048-dim
and pgvector caps HNSW/IVFFlat at 2000" is corrected: since pgvector 0.7 the 16-bit
`halfvec` type indexes up to 4000 dims (verified on the running
`pgvector/pgvector:pg16`, pgvector 0.8.4). Migration `v1.1.0.sql` adds

    CREATE INDEX ix_document_chunks_embedding_hnsw ON document_chunks
      USING hnsw ((embedding::halfvec(2048)) halfvec_cosine_ops);

The `embedding` column stays full-precision `vector(2048)` for storage/scoring
(half-precision *indexing* only): recall is effectively unchanged and dense search
is no longer an exact sequential scan over each user's chunks. `crud/chunks.py`
`dense_search` orders by the identical `embedding::halfvec(2048) <=> q::halfvec(2048)`
expression and raises `hnsw.ef_search` to cover the candidate pool, so the planner
uses the index. The dedicated-vector-DB migration thresholds (Alternatives) are
unchanged — this defers that cliff, it does not move it.

## Update — v1.2.0: Chinese sparse retrieval via pg_trgm

v1.0.0's sparse branch was `tsv = to_tsvector('simple', content)`, but `simple`
does not segment CJK, so Chinese queries matched almost nothing and hybrid silently
degraded to dense-only. This corpus is small and mostly Chinese, so v1.2.0 switches
the sparse branch to pg_trgm character-trigram matching — no custom image needed
(`zhparser`/`pg_jieba` are absent from `pgvector/pgvector:pg16`), GIN-accelerated.
Migration `v1.2.0.sql` drops the dead `tsv` column + its GIN index, adds
`CREATE EXTENSION pg_trgm` and a `gin (content gin_trgm_ops)` index; `crud/chunks.py`
`sparse_search` now scores with `word_similarity(query, content)` (filtered by `<%`,
`pg_trgm.word_similarity_threshold` lowered to 0.2 for a high-recall candidate pool),
and RRF + rerank restore precision. Verified: query `年假政策` recalls
`公司年假政策…` (word_similarity 0.6) via `Bitmap Index Scan on
ix_document_chunks_content_trgm` — where the `simple` config returned zero rows.
Trade-off: trigram is character-level, not word-level; adequate at this scale, with
word-level `zhparser` reserved as a later upgrade if precision demands it.

## Update — knowledge management UI lands in the admin MFE

The MVP's "standalone knowledge-base MFE is out of scope" note is now resolved
without spinning up a new micro-frontend: the document-management surface ships
inside the existing **admin** MFE (管理配置 → 知识库管理,
`/platform/admin/knowledge`), reusing knowledge's public `/documents` API via the
frontend `api` package (`listKnowledgeDocuments` / `uploadKnowledgeDocuments` /
`fetchKnowledgeDocument` / `updateKnowledgeDocument` / `deleteKnowledgeDocument` /
`batchDeleteKnowledgeDocuments`). It covers local import (upload → MarkItDown →
auto-index), list, per-document download of the original bytes, view/edit
(Markdown via the shared MarkdownEditor, which re-indexes on save), single
delete, and **batch delete**.

Batch delete is the only new backend surface: `POST /documents/batch-delete`
(`{ ids }`) deletes the caller's rows in one transaction, best-effort purging
object-store blobs and dropping `document_chunks` via the FK `ON DELETE CASCADE`.
Documents stay **user-scoped** (the operator's own knowledge base, filtered by
`X-Auth-User-ID`); a shared/global enterprise corpus is a deliberately deferred
decision, not part of this change. The management view lists `kind=source`
(operator-uploaded docs) so agent-generated artifacts don't leak in. Contract
regenerated: `knowledge-server.json` + orval `generated/knowledge-server`.
