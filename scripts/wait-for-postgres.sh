#!/usr/bin/env bash
set -euo pipefail
echo "→ Waiting for postgres..."
CONTAINER="${POSTGRES_CONTAINER:-monorepo-postgres}"

until docker exec "$CONTAINER" pg_isready -U workflow --quiet 2>/dev/null; do
  sleep 1
done
