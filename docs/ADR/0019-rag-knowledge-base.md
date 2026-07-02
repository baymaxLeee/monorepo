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
  `document_chunks` (GIN on `tsv`; no ANN index because doubao-embedding-text is
  2048-dim and pgvector's HNSW/IVFFlat cap at 2000 — dense search is exact,
  fine at MVP scale). `documents` and
  the artifact tables are reproduced faithfully as a fresh PG baseline
  (`v1.0.0.sql`), which also fixes prior MySQL-migration/model drift.
- Embedding model and the `vector(2048)` column must agree; changing the
  embedding model/dimension requires altering the column and re-indexing
  (`embed_model` is stored per chunk to detect drift).
- Chinese BM25 uses the `simple` text-search config (no CJK word segmentation);
  dense retrieval carries semantics. `zhparser`/`pg_jieba` is a later upgrade.
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
