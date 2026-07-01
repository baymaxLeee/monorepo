#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXECUTOR_DIR="$ROOT/apps/backend/services/executor"

if [ ! -f "$EXECUTOR_DIR/.env" ]; then
  echo "⚠ $EXECUTOR_DIR/.env missing; skipping workflow-postgres schema setup (run install-deps.sh)" >&2
  exit 0
fi

# Idempotent (safe to run on every `just up`), per workflow's own docs.
echo "→ Setting up workflow-postgres schema..."
cd "$EXECUTOR_DIR"
npx workflow-postgres-setup
echo "✓ workflow-postgres schema ready"
