# ADR 0073: Single-baseline service databases

**Date**: 2026-09-24
**Status**: Accepted
**Supersedes in part**: ADR-0029 migration-file strategy

## Context

Every local and Single-VPS installation may be rebuilt from scratch, and the
product has no persisted-data compatibility obligation. The repository
nevertheless carries 74 incremental SQL files across eight service-owned
databases. Several of those migrations create, rename, backfill, and later drop
the same structures. That history no longer represents a supported upgrade
path and makes the executable schema harder for humans and code agents to
review.

The mismatch became operationally visible after Canvas was correctly folded
into `v1.0.0`: an existing local database recorded `v1.4.0`, so `just up`
reported an unsupported downgrade even though the intended operation was a
destructive reinstall. Preserving the historical chain or teaching the runner
to downgrade would contradict the repository's explicit compatibility policy.

ADR-0029 previously retained the translated migration sequence because manual
schema synthesis could omit an `ALTER`. That concern remains valid, but it is
addressed by materializing every current chain into PostgreSQL first, deriving
the canonical schema from the database, and applying the resulting baseline to
a second empty database. It is not addressed by retaining obsolete history.

## Decision

1. Every service-owned database has exactly one SQL migration:
   `migrations/versions/v1.0.0.sql`.
2. `v1.0.0.sql` is the complete current schema, not a concatenation of obsolete
   create/alter/drop operations. Existing migration chains are applied to empty
   PostgreSQL databases and the resulting public schema is used to construct
   the baseline.
3. All existing service databases are destroyed and recreated when adopting
   this ADR. No data copy, downgrade, compatibility view, dual read, or schema
   shim is supported.
4. Until the project acquires a real persisted-data compatibility requirement,
   schema changes edit `v1.0.0.sql` directly and require reinstalling the
   affected environment. The migration table records the SHA-256 of the applied
   file; a same-version content mismatch fails with an explicit reset message
   instead of silently running against a stale schema.
5. `scripts/db-migrate.sh` remains the sole schema executor. It still applies
   the baseline and its migration-table update atomically. Extension creation
   remains bootstrap-owned because service roles cannot install extensions.
6. A squash is complete only after each baseline applies to an empty database,
   schema dumps from the source chain and the new baseline compare equal after
   removing dump metadata, seeds succeed, and root `just up`, `just lint`, and
   affected builds pass.
7. Seed data is configuration, not migrated user data. Local bootstrap recreates
   the demo configuration and IAM identity. Single-VPS `iam-bootstrap` must
   recreate the configured super-admin from deployment secrets after `db-init`
   succeeds, and IAM cannot start unless that bootstrap succeeds.

## Consequences

- The supported database lifecycle is explicit: install the current schema or
  reinstall; upgrade from an older demo schema is not a product capability.
- Schema review becomes local to one file per service, and code agents no longer
  need to reconstruct the final state from historical transitions.
- Local data and Asset filesystem bytes from the previous baseline are deleted
  during this adoption. Single-VPS deployments must likewise recreate their
  data volumes with `RESET_DATA=true infra/single-vps/deploy.sh ...` when
  deploying this change.
- Future persisted-data compatibility would be a new architectural decision.
  At that point, versions after `v1.0.0` would become immutable forward
  migrations; this ADR does not pretend that requirement already exists.
