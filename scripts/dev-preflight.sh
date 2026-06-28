#!/usr/bin/env bash
# Checks infra + frontend deps before `just dev`. Does not start Docker.
set -euo pipefail

DEV_PORTS=(8000 8001 8002 8008 8009 8010 3000 3001 3005)

if ! docker ps >/dev/null 2>&1; then
  echo "✗ Docker is not reachable. Start Docker Desktop and retry." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^monorepo-mysql$'; then
  echo "✗ MySQL not running. Run: just up" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^monorepo-redis$'; then
  echo "✗ Redis not running. Run: just up" >&2
  exit 1
fi

if [ ! -d apps/frontend/node_modules/.pnpm ]; then
  echo "✗ Frontend deps missing. Run: just install" >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1; then
  for port in "${DEV_PORTS[@]}"; do
    if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "✗ Dev port $port is already in use:" >&2
      lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
      echo "  Stop the existing process before running just dev." >&2
      exit 1
    fi
  done
fi

echo "✓ Dev preflight OK (infra detected)"
