#!/usr/bin/env bash
# Create local MySQL databases and apply service-owned SQL migrations.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICES_DIR="$ROOT/apps/backend/services"
CLICKHOUSE_CONTAINER="${CLICKHOUSE_CONTAINER:-monorepo-clickhouse}"
CLICKHOUSE_INIT_SQL="$ROOT/infra/observability/clickhouse/init.sql"

service_has_sql_migrations() {
  compgen -G "$1/migrations/versions/*.sql" >/dev/null
}

echo "→ discovering service-owned database migrations"
SERVICE_DIRS=()
while IFS= read -r service_dir; do
  if service_has_sql_migrations "$service_dir"; then
    SERVICE_DIRS+=("$service_dir")
  fi
done < <(find "$SERVICES_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

if [ "${#SERVICE_DIRS[@]}" -eq 0 ]; then
  echo "⚠ no service SQL migrations found under $SERVICES_DIR/*/migrations/versions" >&2
  exit 1
fi

if [ "${RESET_DEMO_DATA:-false}" = "true" ]; then
  echo "→ resetting service databases"
  for service_dir in "${SERVICE_DIRS[@]}"; do
    db="$(basename "$service_dir" | tr '-' '_')"
    docker exec -i "${MYSQL_CONTAINER:-monorepo-mysql}" mysql \
      -u"${MYSQL_ROOT_USER:-root}" -p"${MYSQL_ROOT_PASSWORD:-dev}" \
      -e "DROP DATABASE IF EXISTS \`$db\`;"
  done
fi

echo "→ dropping legacy database: identity"
docker exec -i "${MYSQL_CONTAINER:-monorepo-mysql}" mysql \
  -u"${MYSQL_ROOT_USER:-root}" -p"${MYSQL_ROOT_PASSWORD:-dev}" \
  -e "DROP DATABASE IF EXISTS \`identity\`;"

for service_dir in "${SERVICE_DIRS[@]}"; do
  service="$(basename "$service_dir")"
  echo "→ preparing database for service: $service"
  "$ROOT/scripts/db-migrate.sh" "$service_dir"
done

ADMIN_DIR="$SERVICES_DIR/admin"
IAM_DIR="$SERVICES_DIR/iam"

if [ ! -f "$ADMIN_DIR/.env" ]; then
  echo "⚠ $ADMIN_DIR/.env missing; copy from .env.example" >&2
  exit 1
fi

echo "→ Seeding admin demo data..."
cd "$ADMIN_DIR"
uv run python - <<'PY'
import asyncio

from admin.db import close_db, seed_demo_bots


async def main() -> None:
    await seed_demo_bots()
    await close_db()


asyncio.run(main())
PY
echo "✓ admin demo data ready"

echo "→ Seeding iam demo data..."
cd "$IAM_DIR"
IAM_MYSQL_DATABASE=iam go run ./cmd/migrate
echo "✓ iam demo data ready"

echo "→ Preparing ClickHouse telemetry schema..."
docker exec -i "$CLICKHOUSE_CONTAINER" clickhouse-client --multiquery < "$CLICKHOUSE_INIT_SQL"
echo "✓ ClickHouse telemetry schema ready"
