#!/usr/bin/env bash
set -euo pipefail

echo "→ Waiting for ClickHouse..."
CONTAINER="${CLICKHOUSE_CONTAINER:-monorepo-clickhouse}"

until docker exec "$CONTAINER" wget --spider -q "http://127.0.0.1:8123/ping" 2>/dev/null; do
  sleep 1
done
