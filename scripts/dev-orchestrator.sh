#!/usr/bin/env bash
set -euo pipefail

export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}"
export OTEL_EXPORTER_OTLP_PROTOCOL="${OTEL_EXPORTER_OTLP_PROTOCOL:-http/protobuf}"

# telemetry reads ClickHouse over HTTP for the admin observability panel. Match
# the dev compose credentials (see docker-compose.yml observability profile) so
# the panel shows span counts locally after `just up-observability`.
export CLICKHOUSE_HTTP_URL="${CLICKHOUSE_HTTP_URL:-http://localhost:8123}"
export CLICKHOUSE_USER="${CLICKHOUSE_USER:-default}"
export CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-clickhouse}"

if command -v overmind >/dev/null 2>&1; then
  echo "→ Starting via overmind (Procfile.dev)"
  exec overmind start -f Procfile.dev
fi

if command -v mprocs >/dev/null 2>&1; then
  echo "→ Starting via mprocs"
  exec mprocs --config Procfile.dev
fi

if command -v hivemind >/dev/null 2>&1; then
  echo "→ Starting via hivemind"
  exec hivemind Procfile.dev
fi

echo "No process manager found. Falling back to shell mode."
echo "  Tip: brew install overmind"
exec "$(dirname "$0")/dev-stack.sh"
