#!/usr/bin/env bash
# One-shot Postgres DB init for the single-VPS profile.
#
# Creates each service database on the shared Postgres instance and applies
# pending migrations by delegating to the canonical scripts/db-migrate.sh
# (DB_MIGRATE_TRANSPORT=tcp → psql straight at the Postgres service, since no
# docker socket exists in this container). Prod-only seed SQL runs afterwards.
# Re-deploys are no-ops: db-migrate.sh skips already-applied versions and the
# seed is ON CONFLICT.
#
# Env (passed by docker-compose):
#   POSTGRES_HOST / POSTGRES_PORT / POSTGRES_ADMIN_USER / POSTGRES_ADMIN_PASSWORD
#   <SERVICE>_POSTGRES_PASSWORD for every service database
set -euo pipefail

export DB_MIGRATE_TRANSPORT=tcp

# service → database naming mirrors scripts/db-migrate.sh (basename of dir).
SERVICES="iam admin chat executor knowledge telemetry"

for svc in ${SERVICES}; do
  password_var="$(printf '%s_POSTGRES_PASSWORD' "$svc" | tr '[:lower:]' '[:upper:]')"
  password="${!password_var:?$password_var is required}"
  echo "→ migrating ${svc}"
  DATABASE_USER="$svc" DATABASE_PASSWORD="$password" /db-migrate.sh "/schema/${svc}"
done

# Prod seed (idempotent ON CONFLICT), applied AFTER schema. Layout: /seed/<db>/*.sql.
for f in /seed/*/*.sql; do
  [ -e "$f" ] || continue
  db="$(basename "$(dirname "$f")")"
  echo "→ seeding $(basename "$f") into ${db}"
  password_var="$(printf '%s_POSTGRES_PASSWORD' "$db" | tr '[:lower:]' '[:upper:]')"
  PGPASSWORD="${!password_var}" psql -v ON_ERROR_STOP=1 \
    -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT:-5432}" -U "$db" -d "$db" -f "$f"
done

echo "✓ db-init complete"
