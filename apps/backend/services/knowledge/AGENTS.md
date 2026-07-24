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
  and the staged generic file-tree/change-set store shared by chat and executor.
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
- `src/main.py` — FastAPI app
- `src/api/http/routes/*.py` — HTTP handlers (incl. `retrieval_internal.py`)
- `src/application/*.py` — ingest, conversion, object store, indexing,
  retrieval, embed/rerank client, and contextual retrieval
- `src/domain/` — text chunking rules and indexing outcomes
- `src/gen_openapi.py` — OpenAPI export
- `scripts/eval_rag.py` — manual retrieval quality check (NOT CI / NOT tests)

## Conventions
- Documents are user-scoped; `conversation_id` is an optional tag only (no FK).
- HTML artifact generation is execution state, not the model-facing file API.
  The target file tree uses stable relative paths and per-path SHA values;
  deliverable change sets compare their baseline at promotion time and replace
  the current tree atomically.
- Deleting a chat conversation asynchronously removes generated `artifact`
  documents, artifact-generation blocks, and staged media through Chat's
  transactional outbox. User-uploaded `source` documents remain independently
  owned Knowledge content.
- Both **convert and indexing are async and decoupled from ingest progress**
  (ADR-0019 v1.6.0 + v1.7.0): the ingest SSE returns at `received/100` (bytes
  stored + referenceable); `application/processor.py` (`schedule_process`) then runs
  MarkItDown/vision convert in the background (`received`→`converting`→`ready`)
  and chains `application/indexer.py` (`schedule_index`) for embedding. `file_ready`
  means "received", NOT "converted". `index_status` tracks the RAG lifecycle
  separately; `POST /documents/{id}/reindex` retries; `sweep_process()` (convert)
  then `sweep_claim()` (index) recover on startup. Both are single-process demo
  schedulers (advisory-lock single-flight + dirty re-run), not durable queues.
- Reading a not-yet-converted file: the internal `/documents/{id}/slice` endpoint
  takes `wait_ms` and returns `state: ready|processing|failed`; chat `read_file`
  long-polls it so a just-uploaded file becomes readable as soon as convert ends.
- RAG index is kept fresh: re-index on document change; `document_chunks` has an
  `ON DELETE CASCADE` FK so deleting a document removes its chunks.
- Embedding model and the `vector(N)` column dimension must agree; changing the
  model requires altering the column + re-indexing.
- Errors via `kernel.errors.*`, NEVER raw HTTPException.
- Transactions (ADR-0037): persistence repositories only read/stage and never commit; the
  router/service owning a write opens `async with write_tx(session):`
  (autobegin-first) around its reads + writes. `ObjectStore` IO normally stays outside
  the block. Artifact publish is the deliberate exception: its local-filesystem atomic
  replacement runs under the document `FOR UPDATE` lock so a stale revision can never
  overwrite `current.html`. `index_document` is DB-free (snapshot -> chunks); the
  ingest/indexer worker sessions keep intentional multi-stage `write_tx` blocks
  for durable SSE/background progress; the `pg_advisory_lock` raw connection is exempt.
