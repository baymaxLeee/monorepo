#!/usr/bin/env bash
# Checks infra + frontend deps before `just dev`. Does not start Docker.
set -euo pipefail

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

echo "✓ Dev preflight OK (infra detected)"
