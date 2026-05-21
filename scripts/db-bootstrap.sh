#!/usr/bin/env bash
# Create local MySQL databases and apply each service-owned dev schema.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${MYSQL_CONTAINER:-monorepo-mysql}"
APP_USER="${MYSQL_USER:-dev}"
ROOT_USER="${MYSQL_ROOT_USER:-root}"
ROOT_PASS="${MYSQL_ROOT_PASSWORD:-dev}"
DATABASES=(admin gateway identity)

for db in "${DATABASES[@]}"; do
  exists=$(docker exec "$CONTAINER" mysql -u"$ROOT_USER" -p"$ROOT_PASS" -N -e \
    "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$db'" 2>/dev/null | grep -c "^$db$" || echo "0")
  if [ "$exists" = "1" ]; then
    echo "✓ database exists: $db"
  else
    echo "→ creating database: $db"
    docker exec "$CONTAINER" mysql -u"$ROOT_USER" -p"$ROOT_PASS" -e \
      "CREATE DATABASE IF NOT EXISTS \`$db\`;"
  fi
  docker exec "$CONTAINER" mysql -u"$ROOT_USER" -p"$ROOT_PASS" -e \
    "GRANT ALL PRIVILEGES ON \`$db\`.* TO '$APP_USER'@'%';"
done

docker exec "$CONTAINER" mysql -u"$ROOT_USER" -p"$ROOT_PASS" -e "FLUSH PRIVILEGES;"

ADMIN_DIR="$ROOT/apps/backend/services/admin"
IDENTITY_DIR="$ROOT/apps/backend/services/identity"

if [ ! -f "$ADMIN_DIR/.env" ]; then
  echo "⚠ $ADMIN_DIR/.env missing; copy from .env.example" >&2
  exit 1
fi

echo "→ Applying admin schema (create_all + seed)..."
cd "$ADMIN_DIR"
uv run python - <<'PY'
import asyncio

from admin.db import close_db, init_db, seed_demo_bots


async def main() -> None:
    await init_db()
    await seed_demo_bots()
    await close_db()


asyncio.run(main())
PY
echo "✓ admin database schema ready"

echo "→ Applying identity schema (Go create schema)..."
cd "$IDENTITY_DIR"
go run ./cmd/migrate
echo "✓ identity database schema ready"
