#!/usr/bin/env bash
# Start full demo stack in background (shell fallback for `just dev`).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Starting full demo stack (shell mode). Ctrl+C to stop all."

DEV_PORTS=(8000 8001 8002 8008 8009 3000 3001 3005)
PIDS=()

cleanup() {
    pkill -TERM -P $$ 2>/dev/null || true
    for port in "${DEV_PORTS[@]}"; do
        pid=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
        [ -n "$pid" ] && kill -TERM $pid 2>/dev/null || true
    done
    sleep 2
    pkill -KILL -P $$ 2>/dev/null || true
    for port in "${DEV_PORTS[@]}"; do
        pid=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
        [ -n "$pid" ] && kill -KILL $pid 2>/dev/null || true
    done
}
trap cleanup EXIT INT TERM

track_last_pid() {
    PIDS+=("$!")
}

monitor_stack() {
    local running pid status

    while true; do
        running="$(jobs -pr || true)"
        for pid in "${PIDS[@]}"; do
            if ! printf '%s\n' "$running" | grep -qx "$pid"; then
                if wait "$pid"; then
                    status=0
                else
                    status=$?
                fi
                echo "✗ dev process exited (pid $pid, status $status); stopping stack." >&2
                return "$status"
            fi
        done
        sleep 1
    done
}

(
  cd apps/backend/services/admin
  uv run uvicorn admin.main:app --reload --port 8001 2>&1 | sed 's/^/[svc-admin] /'
) &
track_last_pid
(
  cd apps/backend/services/chat
  uv run uvicorn chat.main:app --reload --port 8009 2>&1 | sed 's/^/[svc-chat]  /'
) &
track_last_pid
(
  cd apps/backend/services/telemetry
  uv run uvicorn telemetry.main:app --reload --port 8008 2>&1 | sed 's/^/[telemetry] /'
) &
track_last_pid
(
  cd apps/backend/services/iam
  IAM_MYSQL_DATABASE=iam go run ./cmd/server 2>&1 | sed 's/^/[iam]  /'
) &
track_last_pid
(
  cd apps/backend/services/gateway
  go run ./cmd/server 2>&1 | sed 's/^/[gateway]   /'
) &
track_last_pid
(
  cd apps/frontend
  PORT=3001 pnpm -F admin dev 2>&1 | sed 's/^/[mfe-admin]  /'
) &
track_last_pid
(
  cd apps/frontend
  PORT=3005 pnpm -F chat dev 2>&1 | sed 's/^/[mfe-chat]   /'
) &
track_last_pid
(
  ./scripts/wait-for-url.sh http://localhost:3001/mf-manifest.json mfe-admin 2>&1 | sed 's/^/[wait]      /'
  ./scripts/wait-for-url.sh http://localhost:3005/mf-manifest.json mfe-chat 2>&1 | sed 's/^/[wait]      /'
  cd apps/frontend
  PORT=3000 pnpm -F platform dev 2>&1 | sed 's/^/[platform]  /'
) &
track_last_pid

monitor_stack
