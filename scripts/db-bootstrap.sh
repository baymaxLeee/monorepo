#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICES_DIR="$ROOT/apps/backend/services"

service_has_sql_migrations() {
  compgen -G "$1/migrations/versions/*.sql" >/dev/null
}

# Non-MySQL services (e.g. knowledge on Postgres) opt out of this MySQL
# bootstrap with a `migrations/engine` marker; they are migrated separately
# once their engine's container is up (see justfile `up`).
service_migration_engine() {
  if [ -f "$1/migrations/engine" ]; then
    tr -d '[:space:]' < "$1/migrations/engine"
  else
    echo "mysql"
  fi
}

echo "→ discovering service-owned database migrations (MySQL)"
SERVICE_DIRS=()
while IFS= read -r service_dir; do
  if service_has_sql_migrations "$service_dir" && [ "$(service_migration_engine "$service_dir")" = "mysql" ]; then
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
CHAT_DIR="$SERVICES_DIR/chat"
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

if [ -f "$CHAT_DIR/.env" ] && [ -f "$CHAT_DIR/package.json" ]; then
  echo "→ chat is Node; skipping Python demo seed (create conversations via UI)"
elif [ -f "$CHAT_DIR/.env" ]; then
  echo "→ Seeding chat demo data..."
  cd "$CHAT_DIR"
  uv run python - <<'PY'
import asyncio

from chat.db import close_db, seed_demo_conversations


async def main() -> None:
    await seed_demo_conversations()
    await close_db()


asyncio.run(main())
PY
  echo "✓ chat demo data ready"
else
  echo "⚠ $CHAT_DIR/.env missing; skipping chat seed (run install-deps.sh)" >&2
fi

echo "→ Seeding iam demo data..."
cd "$IAM_DIR"
IAM_MYSQL_DATABASE=iam go run ./cmd/migrate
echo "✓ iam demo data ready"
