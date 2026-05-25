# telemetry service

Telemetry ingestion and query microservice. Owns ClickHouse-backed RUM event
storage and dashboard query APIs.

## Owns

- ClickHouse database: `telemetry`
- HTTP API: `/rum/*`, `/errors/*`, `/healthz`
- Private RUM write protocol used by `@packages/observability`

## Does NOT own

- Authentication token verification; gateway verifies and propagates identity.
- Frontend SDK implementation.
- Backend service tracing exporters.

## Conventions

- Routers are thin: request/response wiring only.
- Write-path validation, redaction, sampling, fingerprinting, and dispatch live
  in `services/ingestion.py`.
- ClickHouse SQL lives in `crud/`.
- Query endpoints must require `X-Auth-*`; anonymous writes are allowed only on
  `/rum/batch`.
- Never trust frontend `user_id`, `username`, `email`, or `is_admin` fields.
