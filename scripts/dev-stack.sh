#!/usr/bin/env bash
# Start full demo stack in background (shell fallback for `just dev`).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Starting full demo stack (shell mode). Ctrl+C to stop all."

DEV_PORTS=(8000 8001 8002 8008 8009 8010 8011 3000 3001 3005)
PIDS=()

cleanup() {
    # Run once: drop the EXIT trap (INT/TERM would otherwise re-trigger it) and
    # ignore further INT/TERM so cleanup cannot be interrupted or recurse.
    trap - EXIT
    trap '' INT TERM
    # 1) Graceful TERM to direct children (the backgrounded subshells).
    pkill -TERM -P $$ 2>/dev/null || true
    # 2) Kill THIS repo's uvicorn --reload supervisors FIRST. They are
    #    grandchildren that `pkill -P $$` cannot reach, and — critically — a
    #    live reloader respawns its worker the instant we free the port, so it
    #    must die before the port backstop runs. Scope to the repo venv so we
    #    never touch a user's unrelated uvicorn processes.
    pkill -KILL -f "$ROOT/apps/backend/.venv/bin/uvicorn" 2>/dev/null || true
    sleep 1
    # 3) Port backstop: KILL anything still listening on our dev ports. This
    #    sweeps orphaned reload workers, `go run` binaries, and node dev servers
    #    that are also grandchildren beyond pkill -P's reach.
    for port in "${DEV_PORTS[@]}"; do
        pids=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
        [ -n "$pids" ] && kill -KILL $pids 2>/dev/null || true
    done
    # 4) Final KILL for any remaining direct children (sed pipes, etc).
    pkill -KILL -P $$ 2>/dev/null || true
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
  PORT=8009 pnpm dev 2>&1 | sed 's/^/[svc-chat]  /'
) &
track_last_pid
(
  cd apps/backend/services/knowledge
  uv run uvicorn knowledge.main:app --reload --port 8010 2>&1 | sed 's/^/[knowledge] /'
) &
track_last_pid
(
  cd apps/backend/services/telemetry
  uv run uvicorn telemetry.main:app --reload --port 8008 2>&1 | sed 's/^/[telemetry] /'
) &
track_last_pid
(
  cd apps/backend/services/executor
  PORT=8011 pnpm dev 2>&1 | sed 's/^/[executor] /'
) &
track_last_pid
(
  cd apps/backend/services/iam
  PORT=8002 IAM_POSTGRES_DATABASE=iam go run ./cmd/server 2>&1 | sed 's/^/[iam]  /'
) &
track_last_pid
(
  cd apps/backend/services/gateway
  PORT=8000 go run ./cmd/server 2>&1 | sed 's/^/[gateway]   /'
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
