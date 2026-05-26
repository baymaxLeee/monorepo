# telemetry service

Telemetry ingestion and query microservice. Owns MySQL-backed RUM event
storage and dashboard query APIs.

## Owns

- MySQL database: `telemetry`
- HTTP API: `/rum/*`, `/errors/*`, `/healthz`
- Private RUM write protocol used by `@packages/observability`

## Does NOT own

- Authentication token verification; gateway verifies and propagates identity.
- Frontend SDK implementation.
- Backend service tracing exporters.

## Conventions

- Routers are thin: request/response wiring only.
- Write-path validation, redaction, sampling, fingerprinting, and dispatch
  live in `services/ingestion.py`.
- ORM models live in `models/`; query helpers in `crud/`.
- Query endpoints must require `X-Auth-*`; anonymous writes are allowed only
  on `/rum/batch`.
- Never trust frontend `user_id`, `username`, `email`, or `is_admin` fields.

## Storage backend

Telemetry was originally specced for ClickHouse (column store, MergeTree,
materialized views). For the demo phase we collapsed it onto the shared
MySQL instance so the single-VPS footprint stays under 1 GB RAM and so we
have one DB to back up.

Trade-offs we accepted:

- `sessions` uses `INSERT ... ON DUPLICATE KEY UPDATE` to emulate the
  `ReplacingMergeTree(ts_server)` semantics.
- Pre-aggregated materialized views (`errors_by_fingerprint_daily`,
  `vitals_p75_by_route_daily`) were dropped. The handful of query endpoints
  we ship just run `GROUP BY` against the raw event tables.
- Row-level TTL is deferred to a periodic `DELETE` job; demo volume doesn't
  warrant it yet.

If event ingest rate climbs into the "tens of millions of rows per day"
range, revisit ClickHouse — the migration path is documented in
`docs/微服务/index.md`.

Consider these rules if they affect your changes.
