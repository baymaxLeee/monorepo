#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICES_DIR="$ROOT/apps/backend/services"

PG_CONTAINER="${POSTGRES_CONTAINER:-monorepo-postgres}"
PG_ADMIN_USER="${POSTGRES_ADMIN_USER:-workflow}"
PG_ADMIN_PASSWORD="${POSTGRES_ADMIN_PASSWORD:-workflow}"

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
    docker exec -i -e PGPASSWORD="$PG_ADMIN_PASSWORD" "$PG_CONTAINER" \
      psql -v ON_ERROR_STOP=1 -U "$PG_ADMIN_USER" -d postgres \
      -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);"
  done
fi

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
import sys

sys.path.insert(0, "src")

from db import close_db, seed_demo_apps


async def main() -> None:
    await seed_demo_apps()
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

echo "→ Bootstrapping iam identity (super-admin + guest-org)..."
cd "$IAM_DIR"
POSTGRES_USER=iam POSTGRES_PASSWORD=iam IAM_POSTGRES_DATABASE=iam go run ./cmd/server seed
echo "✓ iam identity ready"
