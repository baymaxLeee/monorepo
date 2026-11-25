# Telemetry service

Telemetry owns PostgreSQL-backed RUM ingestion and dashboard queries plus
operational trace queries through its ClickHouse adapter. The Single-VPS
[collector configuration](../../../../infra/single-vps/otel-collector.yaml) owns
the trace export path.

- `/rum/*` is the write path used by `@repo/observability`; dashboard and `/ops/*`
  reads remain authenticated and appropriately scoped.
- Gateway verifies tokens and propagates identity. Anonymous writes are allowed
  only on `/rum/batch`; never trust frontend `user_id`, `username`, `email` or
  `is_admin` fields.
- Validation, redaction, sampling and fingerprinting remain application behavior.
  HTTP handlers do not issue SQL or ClickHouse queries directly.
- PostgreSQL owns RUM event/dashboard data. Operational trace queries use the
  ClickHouse adapter; do not silently merge their storage or retention semantics.
- Frontend SDK behavior and backend tracing exporters remain with their own
  packages/services.

Run `just test backend/telemetry`; cover anonymous/authenticated scope, redaction
and storage failure behavior. Run `just sync` when the public contract changes.
