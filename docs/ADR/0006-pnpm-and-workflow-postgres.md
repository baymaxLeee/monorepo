# ADR 0006: Reproducible pnpm and durable Workflow PostgreSQL

## Status

Partially superseded by ADR-0011. The Workflow PostgreSQL decision no longer applies.

## Decision

- Pin pnpm once in the repository root `packageManager` field. All workspaces
  and Node image builds inherit that version through Corepack.
- Keep dependency build-script permissions explicit in each pnpm workspace.
- Use `@workflow/world-postgres` for every deployed chat service.
- Run the official `workflow-postgres-setup` command as a separate init
  workload before chat starts; chat never mutates its schema at startup.
- Single-VPS owns a dedicated PostgreSQL container and persistent volume.
  Kubernetes receives an external PostgreSQL URL through `chat-secrets`.

## Rationale

Package-manager versions affect lockfile interpretation, dependency layout,
and install scripts even though they are not part of the application runtime.
A single pin keeps installs reproducible without duplicating policy per app.

Workflow run, step, event, hook, queue, and stream state must survive chat
process restarts. The local filesystem World cannot provide that guarantee in
containers, and the PostgreSQL World requires its official migrations before
the runtime starts.
