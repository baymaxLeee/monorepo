#!/usr/bin/env bash
# Ensure Postgres databases exist (for volumes created before docker-compose env changed).
set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-monorepo-postgres}"
USER="${POSTGRES_USER:-dev}"

for db in admin admin_test gateway gateway_test; do
  exists=$(docker exec "$CONTAINER" psql -U "$USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$db'" 2>/dev/null || echo "")
  if [ "$exists" = "1" ]; then
    echo "✓ database exists: $db"
  else
    echo "→ creating database: $db"
    docker exec "$CONTAINER" psql -U "$USER" -d postgres -c "CREATE DATABASE \"$db\";"
    docker exec "$CONTAINER" psql -U "$USER" -d postgres -c \
      "GRANT ALL PRIVILEGES ON DATABASE \"$db\" TO \"$USER\";"
  fi
done
