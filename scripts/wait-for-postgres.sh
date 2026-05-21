#!/usr/bin/env bash
set -euo pipefail
echo "→ Waiting for Postgres..."
until docker exec monorepo-postgres pg_isready -U dev -q 2>/dev/null; do
  sleep 1
done
