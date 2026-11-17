#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICES_DIR="$ROOT/apps/backend/services"

PG_CONTAINER="${POSTGRES_CONTAINER:-monorepo-postgres}"
PG_ADMIN_USER="${POSTGRES_ADMIN_USER:-workflow}"
PG_ADMIN_PASSWORD="${POSTGRES_ADMIN_PASSWORD:-workflow}"

service_has_sql_migrations() {
  compgen -G "$1/migrations/v*/*.up.sql" >/dev/null
}

echo "→ discovering service-owned database migrations"
SERVICE_DIRS=()
while IFS= read -r service_dir; do
  if service_has_sql_migrations "$service_dir"; then
    SERVICE_DIRS+=("$service_dir")
  fi
done < <(find "$SERVICES_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

if [ "${#SERVICE_DIRS[@]}" -eq 0 ]; then
  echo "⚠ no service SQL migrations found under $SERVICES_DIR/*/migrations/v*/*.up.sql" >&2
  exit 1
fi

if [ "${RESET_DEMO_DATA:-false}" = "true" ]; then
  echo "→ resetting service databases"
  for service_dir in "${SERVICE_DIRS[@]}"; do
    db="$(basename "$service_dir" | tr '-' '_')"
    docker exec -i -e PGPASSWORD="$PG_ADMIN_PASSWORD" "$PG_CONTAINER" \
      psql -v ON_ERROR_STOP=1 -U "$PG_ADMIN_USER" -d postgres \
      -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);"
  done
fi

for service_dir in "${SERVICE_DIRS[@]}"; do
  service="$(basename "$service_dir")"
  echo "→ preparing database for service: $service"
  db="$service"
  DATABASE_NAME="$db" DATABASE_USER="$db" DATABASE_PASSWORD="$db" \
    "$ROOT/scripts/db-migrate.sh" "$service_dir"
done

IAM_DIR="$SERVICES_DIR/iam"

echo "→ Admin and Chat demo resources are created through their HTTP APIs"

echo "→ Bootstrapping iam identity (super-admin + guest-workspace)..."
cd "$IAM_DIR"
POSTGRES_USER=iam POSTGRES_PASSWORD=iam IAM_POSTGRES_DATABASE=iam go run ./cmd/seed
echo "✓ iam identity ready"
