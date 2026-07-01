#!/usr/bin/env bash
set -euo pipefail
echo "→ Waiting for workflow-postgres..."
CONTAINER="${WORKFLOW_POSTGRES_CONTAINER:-monorepo-workflow-postgres}"

until docker exec "$CONTAINER" pg_isready -U workflow --quiet 2>/dev/null; do
  sleep 1
done
