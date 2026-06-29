#!/usr/bin/env bash
# Reset non-admin service databases after architectural refactors.
# Keeps admin (and iam accounts) intact; recreates chat/knowledge/gateway/telemetry schemas.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${MYSQL_CONTAINER:-monorepo-mysql}"
ROOT_USER="${MYSQL_ROOT_USER:-root}"
ROOT_PASS="${MYSQL_ROOT_PASSWORD:-dev}"
APP_USER="${MYSQL_USER:-dev}"

RESET_DBS=(chat knowledge gateway telemetry)

echo "→ resetting databases (admin + iam are preserved): ${RESET_DBS[*]}"

for db in "${RESET_DBS[@]}"; do
  docker exec -i "$CONTAINER" mysql -u"$ROOT_USER" -p"$ROOT_PASS" -e \
    "DROP DATABASE IF EXISTS \`$db\`; CREATE DATABASE \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; GRANT ALL ON \`$db\`.* TO '$APP_USER'@'%';"
done

for svc in chat knowledge gateway telemetry; do
  if [ -d "$ROOT/apps/backend/services/$svc/migrations/versions" ]; then
    echo "→ migrating $svc"
    "$ROOT/scripts/db-migrate.sh" "$ROOT/apps/backend/services/$svc"
  fi
done

if [ -d "$ROOT/apps/backend/services/iam" ]; then
  echo "→ re-seeding iam demo data (accounts preserved in iam DB)"
  (cd "$ROOT/apps/backend/services/iam" && IAM_MYSQL_DATABASE=iam go run ./cmd/migrate)
fi

echo "✓ demo DB reset complete (admin data untouched)"
