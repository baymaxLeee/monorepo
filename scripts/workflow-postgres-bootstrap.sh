#!/usr/bin/env bash
# Wait for the local Workflow Postgres and apply the official idempotent schema setup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHAT_DIR="$ROOT/apps/backend/services/chat"
WORKFLOW_POSTGRES_URL="${WORKFLOW_POSTGRES_URL:-postgres://dev:dev@localhost:5432/workflow}"

echo "→ Waiting for Workflow Postgres..."
for attempt in $(seq 1 30); do
  if docker compose -f "$ROOT/docker-compose.yml" exec -T workflow-postgres \
    pg_isready -U dev -d workflow >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "✗ Workflow Postgres did not become ready" >&2
    exit 1
  fi
  sleep 1
done

if [ ! -x "$CHAT_DIR/node_modules/.bin/workflow-postgres-setup" ]; then
  echo "✗ Workflow dependencies missing. Run: just install" >&2
  exit 1
fi

echo "→ Applying Workflow Postgres schema..."
(
  cd "$CHAT_DIR"
  WORKFLOW_POSTGRES_URL="$WORKFLOW_POSTGRES_URL" pnpm exec workflow-postgres-setup
)
echo "✓ Workflow Postgres ready"
