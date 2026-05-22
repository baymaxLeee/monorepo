#!/usr/bin/env bash
# Start full demo stack in background (shell fallback for `just dev`).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Starting full demo stack (shell mode). Ctrl+C to stop all."
trap 'kill 0' EXIT INT TERM

(
  cd apps/backend/services/admin
  uv run uvicorn admin.main:app --reload --port 8001 2>&1 | sed 's/^/[svc-admin] /'
) &
(
  cd apps/backend/services/iam
  IAM_MYSQL_DATABASE=iam go run ./cmd/server 2>&1 | sed 's/^/[iam]  /'
) &
(
  cd apps/backend/services/api-gateway
  go run ./cmd/server 2>&1 | sed 's/^/[gateway]   /'
) &
(
  cd apps/frontend
  PORT=3001 pnpm -F admin dev 2>&1 | sed 's/^/[mfe-admin]  /'
) &
(
  ./scripts/wait-for-url.sh http://localhost:3001/mf-manifest.json mfe-admin 2>&1 | sed 's/^/[wait]      /'
  cd apps/frontend
  PORT=3000 pnpm -F platform dev 2>&1 | sed 's/^/[platform]  /'
) &

wait
