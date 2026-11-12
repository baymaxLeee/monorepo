#!/usr/bin/env bash
# Recreate non-core application data while preserving Admin and IAM state.
# Run on the VPS from the rendered deployment directory.

set -euo pipefail

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)

if [ ! -f .env ]; then
    echo "✗ .env missing; run render-env.sh first" >&2
    exit 1
fi

# This password is generated as hex by render-env.sh. Read only the required
# key instead of evaluating the complete dotenv file.
WORKFLOW_POSTGRES_PASSWORD="$(sed -n 's/^WORKFLOW_POSTGRES_PASSWORD=//p' .env)"
if [ -z "${WORKFLOW_POSTGRES_PASSWORD}" ]; then
    echo "✗ WORKFLOW_POSTGRES_PASSWORD is missing from .env" >&2
    exit 1
fi

volume_for_mount() {
    local container="$1"
    local destination="$2"
    docker inspect --format "{{range .Mounts}}{{if eq .Destination \"${destination}\"}}{{.Name}}{{end}}{{end}}" \
        "${container}" 2>/dev/null || true
}

storage_volume="$(volume_for_mount monorepo-storage /data/assets)"
redis_volume="$(volume_for_mount monorepo-redis /data)"
clickhouse_data_volume="$(volume_for_mount monorepo-clickhouse /var/lib/clickhouse)"
clickhouse_logs_volume="$(volume_for_mount monorepo-clickhouse /var/log/clickhouse-server)"

echo "→ stopping services that own disposable application data"
"${COMPOSE[@]}" stop \
    admin iam redis storage canvas chat executor knowledge telemetry otel-collector clickhouse \
    db-init workflow-db-init
"${COMPOSE[@]}" rm -f \
    redis storage canvas chat executor knowledge telemetry otel-collector clickhouse \
    db-init workflow-db-init

echo "→ keeping PostgreSQL volume and preserving databases: admin, iam"
for database in storage canvas chat executor knowledge telemetry; do
    docker exec \
        -e PGPASSWORD="${WORKFLOW_POSTGRES_PASSWORD}" \
        monorepo-postgres \
        psql -v ON_ERROR_STOP=1 -U workflow -d postgres \
        -c "DROP DATABASE IF EXISTS \"${database}\" WITH (FORCE);"
done

# Workflow World is executor-owned state. Unlike service databases, it is the
# cluster's bootstrap database, so recreate it before workflow-db-init connects.
docker exec \
    -e PGPASSWORD="${WORKFLOW_POSTGRES_PASSWORD}" \
    monorepo-postgres \
    psql -v ON_ERROR_STOP=1 -U workflow -d postgres \
    -c 'DROP DATABASE IF EXISTS "workflow" WITH (FORCE);'
docker exec \
    -e PGPASSWORD="${WORKFLOW_POSTGRES_PASSWORD}" \
    monorepo-postgres \
    psql -v ON_ERROR_STOP=1 -U workflow -d postgres \
    -c 'CREATE DATABASE "workflow" OWNER "workflow";'

echo "→ clearing all disposable Redis cache and session state"
for volume in \
    "${storage_volume}" \
    "${redis_volume}" \
    "${clickhouse_data_volume}" \
    "${clickhouse_logs_volume}"; do
    if [ -n "${volume}" ]; then
        echo "→ deleting disposable volume ${volume}"
        docker volume rm "${volume}"
    fi
done

echo "✓ application data reset; Admin and IAM data were preserved"
