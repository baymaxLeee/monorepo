#!/usr/bin/env bash
# Recreate local application data while preserving Admin and IAM databases.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_CONTAINER="${POSTGRES_CONTAINER:-monorepo-postgres}"
PG_ADMIN_USER="${POSTGRES_ADMIN_USER:-workflow}"
PG_ADMIN_PASSWORD="${POSTGRES_ADMIN_PASSWORD:-workflow}"
STORAGE_DATA_DIR="$ROOT/apps/backend/services/storage/data"
APPLICATION_DATABASES=(canvas chat knowledge runtime storage telemetry)

cd "$ROOT"

echo "→ starting local data services required for the reset"
docker compose --profile observability up -d postgres redis clickhouse
"$ROOT/scripts/wait-for-postgres.sh"

echo "→ preserving PostgreSQL databases: admin, iam"
for database in "${APPLICATION_DATABASES[@]}"; do
  echo "→ dropping disposable PostgreSQL database: $database"
  docker exec -i -e PGPASSWORD="$PG_ADMIN_PASSWORD" "$PG_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$PG_ADMIN_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE);"
done

echo "→ recreating disposable Workflow World database"
docker exec -i -e PGPASSWORD="$PG_ADMIN_PASSWORD" "$PG_CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U "$PG_ADMIN_USER" -d postgres \
  -c 'DROP DATABASE IF EXISTS "workflow" WITH (FORCE);'
docker exec -i -e PGPASSWORD="$PG_ADMIN_PASSWORD" "$PG_CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U "$PG_ADMIN_USER" -d postgres \
  -c 'CREATE DATABASE "workflow" OWNER "workflow";'

if [ -e "$STORAGE_DATA_DIR" ]; then
  echo "→ deleting disposable local Storage bytes: $STORAGE_DATA_DIR"
  find "$STORAGE_DATA_DIR" -mindepth 1 -delete
fi

echo "→ clearing disposable Redis state"
docker exec monorepo-redis redis-cli FLUSHALL >/dev/null

echo "→ clearing disposable ClickHouse telemetry"
docker compose --profile observability stop otel-collector >/dev/null
docker exec monorepo-clickhouse clickhouse-client --multiquery \
  --query 'DROP DATABASE IF EXISTS otel; CREATE DATABASE otel;'

echo "→ applying fresh application schemas"
"$ROOT/scripts/workflow-postgres-bootstrap.sh"
"$ROOT/scripts/db-bootstrap.sh"

echo "✓ local application data reset; Admin and IAM databases were preserved"
