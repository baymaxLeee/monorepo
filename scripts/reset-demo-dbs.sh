#!/usr/bin/env bash
# Reset non-admin service databases after architectural refactors.
# Keeps admin (and iam accounts) intact; recreates chat/knowledge/telemetry schemas.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_CONTAINER="${POSTGRES_CONTAINER:-monorepo-postgres}"
PG_ADMIN_USER="${POSTGRES_ADMIN_USER:-workflow}"
PG_ADMIN_PASSWORD="${POSTGRES_ADMIN_PASSWORD:-workflow}"

RESET_DBS=(chat knowledge telemetry)

echo "→ resetting databases (admin + iam are preserved): ${RESET_DBS[*]}"

for db in "${RESET_DBS[@]}"; do
  docker exec -i -e PGPASSWORD="$PG_ADMIN_PASSWORD" "$PG_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$PG_ADMIN_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);"
done

for svc in chat knowledge telemetry; do
  if [ -d "$ROOT/apps/backend/services/$svc/migrations/versions" ]; then
    echo "→ migrating $svc"
    "$ROOT/scripts/db-migrate.sh" "$ROOT/apps/backend/services/$svc"
  fi
done

if [ -d "$ROOT/apps/backend/services/iam" ]; then
  echo "→ re-running iam identity bootstrap (accounts preserved in iam DB)"
  (cd "$ROOT/apps/backend/services/iam" && POSTGRES_USER=iam POSTGRES_PASSWORD=iam IAM_POSTGRES_DATABASE=iam go run ./cmd/server seed)
fi

echo "✓ demo DB reset complete (admin data untouched)"
