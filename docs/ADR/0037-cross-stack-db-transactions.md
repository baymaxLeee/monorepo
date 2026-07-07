# ADR 0037: Cross-stack DB transaction boundaries (unit-of-work at the orchestration layer)

## Status

Accepted.

## Context

The three stacks handled database writes inconsistently and mostly without an
explicit transaction, so any multi-table mutation (delete + insert, upsert +
status flip, batch delete) risked partial writes with no automatic rollback:

- **Python** (`admin`, `knowledge`, `telemetry`, SQLAlchemy 2.0 async +
  asyncpg): no request-scoped transaction. Writes relied on scattered manual
  `await session.commit()` and the conventions differed per service —
  `admin`/`telemetry` committed inside the `crud/` layer (one commit per write,
  so a service could not compose two writes atomically), while `knowledge`
  committed in routers/services. Explicit `rollback()` appeared only in a few
  `knowledge` paths.
- **TypeScript** (`chat`, `executor`, Drizzle + postgres.js): Drizzle's
  `db.transaction(async (tx) => {})` (auto commit / auto rollback) was available
  but used in only a couple of places; some multi-step writes (e.g. the chat run
  lease reap-then-claim) ran as separate autocommit statements.
- **Go** (`iam`, GORM): already correct — `Store.Transaction(ctx, fn)` and
  `mutateWithAudit` wrap multi-table work in `db.Transaction`, which commits on
  `nil` and rolls back on `error`.

Connection-pool management was never the gap: every ORM already returns
connections automatically (`async with` for SQLAlchemy, postgres.js `max`,
GORM's `*sql.DB`). The gap was transaction boundaries and automatic rollback.

## Decision

Adopt one convention across all three stacks: **unit-of-work with the
transaction boundary in the orchestration layer; the persistence layer only
reads and stages writes, it never commits.**

- **Python** — use each service's thin `async with write_tx(session):` guard in
  the service/router that owns a write unit of work. The guard delegates to the
  native SQLAlchemy 2.0 `session.begin()` context manager (commit on normal
  exit, rollback on exception) and fails fast if autobegin has already opened a
  transaction. `crud/` functions only `add` / `flush` / `delete` / `select`
  (no `commit`, no `rollback`). The only `refresh` is a compare-and-set helper
  that refreshes inside its caller's transaction.
- **TypeScript** — use Drizzle `getDb().transaction(async (tx) => {})` for
  multi-step / multi-table writes, passing `tx` to every read/write inside.
  Single-statement writes stay as-is; no custom `withTx` wrapper.
- **Go** — unchanged. `iam`'s `Store.Transaction` / `mutateWithAudit` are the
  reference shape for the other stacks.

### `autobegin`-first rule (Python)

A SQLAlchemy `AsyncSession` autobegins a transaction on its first query, and
calling `session.begin()` while one is already active raises
`InvalidRequestError`. Therefore **a mutating unit of work must open
`async with write_tx(session):` before any other session access, and perform all
of its reads and writes inside that block.** Idempotent-create paths must do the
"check existing" read inside the write block (not before it). Pure-read
endpoints do not open a write block.

### External side effects stay out of the transaction

A DB transaction never spans object-store IO, Workflow starts, outbound HTTP,
DNS/SSRF validation, or Redis pub/sub. Concretely:

- `knowledge` artifact publish and media create upload bytes to the object store
  **before** opening the DB `begin` block, so the `SELECT ... FOR UPDATE`
  document-row lock is never held across object-store IO. A rolled-back or lost
  write leaves an orphaned blob (best-effort, acceptable); it never leaves a row
  pointing at a deleted/absent object.
- `knowledge` document/batch delete captures blob refs, deletes rows in the
  `begin` block, then purges the object store **after** commit.
- `admin` provider create/update runs `validate_provider_base_url` (DNS
  resolution) before the `begin` block.
- `chat` `acquireRunLease` reaps + claims the lease in one `db.transaction`, then
  runs the cross-table `finishAgentRun` finalization **outside** it.

### Deliberate exceptions

- `knowledge` ingest (SSE) and background `indexer` keep **multiple** short
  transactions on a dedicated worker session so progress (`storing` →
  `converting` → `ready`, or `indexing` → terminal status) is durably visible
  between stages; each stage is its own `async with write_tx(session)`. The
  chunk build (`index_document`) is DB-free and all provider / embedding IO runs
  outside DB transactions; the final short transaction locks the document,
  verifies the content version, then replaces chunks and writes terminal
  `index_status` together.
- The `pg_advisory_lock` connection in the indexer is a raw
  `engine.connect()`, not the ORM session; its explicit `commit()` is outside
  this convention.

## Consequences

- Multi-table mutations are atomic with automatic rollback everywhere, and the
  three stacks now read the same way.
- Main migration risk: any Python write path that lost its `commit()` but was
  not wrapped in a `write_tx` block would silently roll back at request end and
  drop the write. The change was verified path-by-path (`rg` for
  `commit`/`rollback`/`refresh`/`begin`) and every service lints clean.
- `expire_on_commit=False` (already set on all Python sessions) keeps ORM
  attributes readable after the `begin` block commits, so `crud` no longer needs
  `refresh()` for response serialization. The one remaining `refresh` is
  `knowledge.update_document_if_unchanged`, which syncs the ORM row after a
  compare-and-set Core `UPDATE` and stays inside its caller's transaction.
