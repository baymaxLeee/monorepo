# knowledge service

User-owned document knowledge base: raw object storage, MarkItDown conversion,
persistent artifacts, and RAG retrieval. Chat consumes documents and retrieval
via internal HTTP; a future knowledge MFE manages lifecycle independently of
conversations. See [ADR-0019](../../../../docs/ADR/0019-rag-knowledge-base.md).

## Runtime / storage (ADR-0019)
- Runs on **Postgres + pgvector**, on the shared instance
  (docker-compose `postgres`, image `pgvector/pgvector:pg16`): the
  `knowledge` database sits alongside executor's `workflow` database.
- Migrations run through the shared Postgres path: `scripts/db-migrate.sh`
  applies `migrations/versions/*.sql` via psql, and `just up` migrates it once
  Postgres is ready.

## Owns
- DB tables: `documents` (source uploads + agent artifacts, per user),
  `document_chunks` (RAG: `embedding vector` + generated `tsv` for hybrid),
  artifact generation tables (written by executor).
- Local filesystem object backend (demo / single-VPS)
- HTTP API: `/ingest/*` (public via gateway), `/internal/*` (service-to-service),
  including `POST /internal/retrieve` (hybrid dense+BM25+RRF+rerank, user-scoped)
- Externally: gateway `/api/knowledge-server/*`

## Does NOT own
- Conversations / messages (→ chat service)
- LLM agent runtime + answer generation (→ chat service; retrieval only here)
- User identity verification (→ gateway / iam)
- Embedding/rerank model config (→ admin `provider_kind` embedding/rerank;
  fetched via `/internal/providers/by-kind/{kind}`)

## Entry points
- `src/knowledge/main.py` — FastAPI app
- `src/knowledge/routers/*.py` — HTTP handlers (incl. `retrieval_internal.py`)
- `src/knowledge/services/*.py` — ingest, conversion, object store, indexing,
  retrieval, embed/rerank client, chunking, contextual retrieval
- `src/knowledge/gen_openapi.py` — OpenAPI export
- `scripts/eval_rag.py` — manual retrieval quality check (NOT CI / NOT tests)

## Conventions
- Documents are user-scoped; `conversation_id` is an optional tag only (no FK).
- Deleting a chat conversation does NOT delete knowledge documents.
- RAG index is kept fresh: re-index on document change; `document_chunks` has an
  `ON DELETE CASCADE` FK so deleting a document removes its chunks.
- Embedding model and the `vector(N)` column dimension must agree; changing the
  model requires altering the column + re-indexing.
- Errors via `kernel.errors.*`, NEVER raw HTTPException.
