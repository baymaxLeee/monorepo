#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$ROOT/apps/backend/services/runtime"

if [ ! -f "$RUNTIME_DIR/.env.worker" ]; then
  echo "⚠ $RUNTIME_DIR/.env.worker missing; skipping workflow-postgres schema setup (run install-deps.sh)" >&2
  exit 0
fi

# Idempotent (safe to run on every `just up`), per workflow's own docs.
echo "→ Setting up workflow-postgres schema..."
cd "$RUNTIME_DIR"
pnpm exec node --env-file=.env.worker node_modules/@workflow/world-postgres/bin/setup.js
echo "✓ workflow-postgres schema ready"
