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
   retrieval through a `knowledge_search` tool -> knowledge
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
upload -> auto-index -> `knowledge_search` in chat returns cited passages;
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
frontend `api` package (`listKnowledgeDocuments` / `ingestKnowledgeDocuments` /
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

## Update — single-VPS deployment parity

The single-VPS profile follows the same storage contract as local development
and Kubernetes: `knowledge` uses the shared PostgreSQL instance, never the
legacy MySQL `knowledge` database. The PostgreSQL container therefore uses
`pgvector/pgvector:pg16`, and a one-shot `knowledge-db-init` service runs the
service-owned migrations before the API starts. The regular MySQL `db-init`
does not copy or apply knowledge migrations.

The migration job is part of the knowledge image rather than application
startup. This preserves the service rule that API processes never mutate
schema, while keeping `docker compose up` self-contained and safe for both a
fresh volume and an existing Workflow World volume. Existing demo-era MySQL
knowledge rows are deliberately not migrated; documents are re-ingested as
already decided above.

## Update — multimodal ingestion: caption gating + image dual representation

Once real chat models (not all vision-capable) drove ingest, two problems plus
an outright bug surfaced. All three are now fixed:

1. **Caption bug (止血).** `services/convert.py` spread a provider's `extra_body`
   (e.g. Ark `{"thinking": {...}, "reasoning_effort": "high"}`) as top-level
   OpenAI kwargs, so every image caption raised
   `TypeError: create() got an unexpected keyword argument 'thinking'` and images
   silently fell back to metadata. Non-standard params now ride `extra_body=`
   (both `_describe_image_sync` and the MarkItDown-embedded `_VisionCaptionClient`).

2. **Caption gating.** Ingest captions an image only when the resolved provider
   is `supports_image_input` (ADR-0014 update); a non-vision provider skips the
   caption and degrades to metadata instead of sending the picture and being
   rejected by Ark. Text documents (pdf/office/html/…) are unchanged — they carry
   no provider and go straight through MarkItDown → chunk → embed.

3. **Image dual representation.** Grounded in current (2026) practice — a VLM
   caption for lexical/keyword recall *plus* a native image embedding for semantic
   recall — an image document is now indexed two ways in the single
   `document_chunks` / pgvector space:
   - the caption Markdown is chunked and text-embedded as before (BM25 + dense
     over text), **and**
   - the image body itself is embedded via a multimodal embedding model
     (`embed_client.embed_image` → Ark `/embeddings/multimodal` with an `image_url`
     data-URI) and stored as one extra chunk whose dense `embedding` is the image
     vector and whose `content` is a `[图片] <name>` marker + caption snippet (for
     BM25 / rerank / display).

   This is **gated and best-effort**: it runs only when the embedding provider is
   multimodal (`is_multimodal_embedding_model`, i.e. `doubao-embedding-vision-*`)
   and the returned vector matches the configured `embedding_dim`; otherwise the
   image vector is skipped and the document stays caption-only. No new migration —
   the image vector reuses the existing `vector(embedding_dim)` column and the
   v1.1.0 halfvec HNSW index. Retrieval (hybrid + RRF + rerank) is unchanged:
   image and text chunks share one vector column, so an image-semantic query now
   recalls the picture's chunk.

**Deferred (next round).** The answer side still cites images through the caption
chunk's text/title. Feeding the *original image* back to a vision-capable chat
model as an AI SDK `file` part on a retrieval hit — with official `source-*`
stream parts for citation — is intentionally out of this round's scope; the
retrieval + dual-index groundwork here is its prerequisite.

## Update — v1.6.0: indexing decoupled from ingest progress (async background)

Decisions 3-4 above ran `index_document` **synchronously inside the ingest SSE**
(and inside the document-edit PATCH): the per-file `file_ready` event, and the
whole `[DONE]`, only fired after embedding + Contextual Retrieval + chunk writes
finished. Embedding is the slowest, most failure-prone step (external
model calls) and is **not** required for the document to be considered imported —
the file is received, stored, and converted well before it is retrievable. So the
progress stream was blocked on work the user does not need to wait for.

**Change.** Ingest/edit now return as soon as the document is `ready/100`
(received + stored + converted); embedding/chunking runs asynchronously.

- New `documents.index_status` (`pending`/`indexing`/`indexed`/`skipped`/`failed`)
  + `index_error`, tracked **separately** from `ingest_status` so the RAG-index
  lifecycle is observable and retryable. Column defaults to `skipped`, so agent
  artifacts (never chunked) need no code change; only ingest/edit/reindex set
  `pending` to enqueue. Migration `v1.6.0.sql` backfills by real chunk existence
  (`EXISTS (SELECT 1 FROM document_chunks …)` → `indexed`; source-with-content but
  no chunks → `pending`; else `skipped`) — the old ingest swallowed index errors
  and still emitted `file_ready`, so "kind=source" alone did not imply indexed.
- `IndexResult` is now structured (`status: indexed|skipped|failed` + `reason`)
  instead of a free-form `note`, so the background runner classifies outcomes
  without string-parsing.
- `services/indexer.py` is the background runner: `schedule_index()` fire-and-
  forget tasks (bounded by `index_max_parallel`), `sweep_claim()` re-queues
  survivors at startup (resets crashed `indexing` → `pending`). A new
  `POST /documents/{id}/reindex` retries a skipped/failed document; the admin UI
  shows a secondary "索引中/可检索/索引失败" badge, a "重试索引" action, and
  polls while any row is pending/indexing.
- **Per-document correctness** under concurrent triggers (import / PATCH /
  reindex / autosave / sweep):
  - a Postgres advisory lock held for the whole run gives single-flight across
    processes/replicas, so two runs never contend the
    `ux_document_chunks_doc_index` unique constraint;
  - `index_document` deletes the doc's chunks **up front**, so any outcome
    (no provider / dim mismatch / no text) leaves no stale chunks — retrieval
    reads `document_chunks` directly and does not consult `index_status`, so a
    skipped/failed re-index after an edit must not keep old content searchable.
    Trade-off: a re-index while the embedding provider is down drops the doc from
    retrieval until a later successful run (sweep or manual reindex), which is
    preferable to serving outdated content;
  - the terminal status write is a compare-and-set on `updated_at` (the content
    version, never bumped by status writes): if an edit lands mid-index the guard
    fails and the stale result is discarded rather than marking new content
    `indexed`;
  - an in-memory dirty flag (`_pending[id] = True`) records schedules that arrive
    while a doc is already running and re-runs once on completion, so a burst of
    autosave edits never drops a schedule or leaves a row stuck in `indexing`.

**Reliability boundary (explicit).** This is a **single-process, in-memory
scheduler** — deliberately not a durable job system. Tasks are lost on
crash/deploy and recovered only by the startup sweep; multi-replica safety rests
on the advisory lock, not on persisted queues, so it is best-effort not
exactly-once. If durable, resumable, observable execution across crashes and
deployments is later required, this should move to the executor service's
Workflow DevKit (durable/resumable steps, managed state) rather than growing more
in-process machinery.

**Consequence.** There is now a short window after import where a document is
readable (`read_file` / `content_md`) but not yet retrievable via RAG
(`knowledge_search`), since chunks/BM25 are written by `index_document`. This is
the intended trade-off — import progress reflects storage, not embedding.

## Update — v1.7.0: convert decoupled too ("upload = ask", convert in background)

v1.6.0 moved *indexing* off the ingest request, but **conversion still ran inside
it**: the `converting` → `ready` gap was a synchronous
MarkItDown/vision black box (tens of seconds for large PDFs / images), and the
frontend `PromptInput` hard-blocked send until `ingest_status === "ready"`. So a
user still could not ask about a freshly uploaded large file until convert
finished — the classic "stuck at 50%" wait (see the progress-UX finding: a
stalled fabricated percentage is worse than an honest indeterminate state).

**Change.** Ingest now returns at `received/100` — bytes stored + row
referenceable — and the heavy convert runs in the background, mirroring how
Codex/Cursor keep upload instant and process asynchronously.

- New `ingest_status` value **`received`** (`pending`→`storing`→`received`→
  `converting`→`ready`), between storing and converting. String column, no DDL.
- `services/processor.py` is the background convert runner, structurally a twin
  of `indexer.py`: `schedule_process()` fire-and-forget (bounded by
  `ingest_max_parallel`), advisory-lock single-flight (namespaced `convert:<id>`
  so it never collides with the indexer's lock), `_pending` dirty re-run, and
  `sweep_process()` startup recovery (resets crashed `converting`→`received`).
  On success it writes `content_md`/`ready`/`index_status=pending` then chains
  `schedule_index()`; on failure it writes `failed` and **keeps the stored
  object** so `read_file`/manual retry still have the source. `main.py` sweeps
  convert before index (a doc must reach `ready` before it can be chunked).
- The public ingest API is now a plain HTTP `POST /ingest` returning
  `{ documents, failed }` once bytes are stored and rows are referenceable. There
  is no upload-progress SSE and no frontend progress ring; the `PromptInput`
  only waits for the returned document id, then allows the file to be sent while
  conversion continues in the background. Admin upload reports "已接收…后台解析与索引".
- **Reading a not-yet-converted file:** the internal slice endpoint gains a
  `wait_ms` long-poll returning `state: ready|processing|failed`. Chat's
  `read_file` long-polls (60s) when the doc is still `received/converting`, so a
  single tool call returns content once convert finishes — the wait moves from
  "upload bar stuck at 50%" to "AI is reading the document" (streaming). Timeout
  → `processing`, convert error → `failed`; both are structured tool outputs, so
  the model can tell the user instead of getting an empty/garbage body. The old
  raw-bytes fallback (useless for binary) is removed.
- **Image fast-path:** images are referenceable at `received`; the caption (for
  non-vision/RAG) is fully backgrounded. For vision input, `projector.ts` inlines
  a **downscaled variant** (longest edge ≤ 1536px, re-encoded JPEG) derived from
  the stored original by `services/image_variant.py` and cached in the object
  store (keyed by source `sha256` + params), served via
  `GET /internal/documents/{id}/source?max_dim=`. Vision models downsample
  internally anyway (~1568px Anthropic / ≤2048px OpenAI), so sending the raw
  multi-megapixel photo only wastes tokens/latency and can stall weaker
  providers on request size; normalizing keeps the body small and reliable while
  the original is preserved for download/RAG. A stall timeout on the streaming
  provider fetch (`transport-ts` `createSecureProviderFetch`) is the last-resort
  backstop so a silent provider can never pin a run.
- **Convert cache:** identical re-uploads reuse a prior `ready` document's
  `content_md` by `object_sha256`, scoped to the same org/user trust boundary and
  restricted to deterministic (non-media) MarkItDown output — vision captions
  depend on provider/model and are never cached.

**Reliability boundary (unchanged).** Same single-process, in-memory, best-effort
caveat as v1.6.0's indexer applies to the processor; durable execution would move
both to the executor's Workflow DevKit.

**Consequence.** The readable-but-not-retrievable window from v1.6.0 now has a
sibling: a just-uploaded file is *referenceable* immediately but briefly not yet
*readable* (convert running) — surfaced honestly via `read_file`'s `processing`
state + server-side wait, not a fake progress bar.
