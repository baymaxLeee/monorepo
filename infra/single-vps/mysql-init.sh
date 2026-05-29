#!/bin/sh
# One-shot DB init for the single-VPS profile.
#
# Runs inside a mysql:8.4 container (which gives us the `mysql` CLI).
# Connects to the `mysql` service via Docker network DNS, creates each
# service database, grants APP_USER, then applies all *.sql files under
# /schema/<db>/ in lexicographic order. All SQL files in this repo use
# IF NOT EXISTS, so re-running is a cheap no-op.
#
# Env (passed by docker-compose):
#   MYSQL_ROOT_PASSWORD  — root password to connect as
#   APP_USER             — username to grant (default 'app')

set -eu

HOST="${MYSQL_HOST:-mysql}"
ROOT_PASS="${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD required}"
APP_USER="${APP_USER:-app}"

mysql_root() {
    # `-N` numeric/no-headers; we use it for control statements too because
    # column headers don't hurt either way.
    MYSQL_PWD="${ROOT_PASS}" mysql -h "${HOST}" -uroot "$@"
}

# Wait a tick past the healthcheck just to be safe — mysql_data init can
# still be finishing GRANT TABLE flush even after `mysqladmin ping` succeeds.
for i in 1 2 3 4 5; do
    if mysql_root -e "SELECT 1" >/dev/null 2>&1; then
        break
    fi
    echo "→ waiting for mysql to accept root connections (attempt $i)..."
    sleep 2
done

# Mirror the service → database naming used by scripts/db-migrate.sh.
# `telemetry` was originally ClickHouse-backed; we moved it onto the shared
# MySQL instance to keep the single-VPS footprint small.
DATABASES="iam admin chat gateway telemetry"

for db in ${DATABASES}; do
    echo "→ ensuring database \`${db}\` exists and APP_USER \`${APP_USER}\` has access"
    mysql_root -e "
        CREATE DATABASE IF NOT EXISTS \`${db}\`
            CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
        GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${APP_USER}'@'%';
    "
done

mysql_root -e "FLUSH PRIVILEGES;"

# Convention: /schema/<db>/*.sql, applied in alphabetical (== semver) order.
# Files are mounted from infra/single-vps/schema/<db>/ in docker-compose.
for db in ${DATABASES}; do
    schema_dir="/schema/${db}"
    if [ ! -d "${schema_dir}" ]; then
        echo "  (no schema dir for ${db}, skipping)"
        continue
    fi
    # Skip directories with no .sql files (POSIX-shell-compatible check).
    if ! ls "${schema_dir}"/*.sql >/dev/null 2>&1; then
        echo "  (no .sql files in ${schema_dir}, skipping)"
        continue
    fi
    for f in "${schema_dir}"/*.sql; do
        echo "  → applying $(basename "${f}") to \`${db}\`"
        mysql_root "${db}" < "${f}"
    done
done

# Convention: /seed/<db>/*.sql, applied AFTER schema, alphabetical order.
# Seeds MUST be idempotent (INSERT ... ON DUPLICATE KEY UPDATE) so re-runs are
# cheap no-ops and never clobber operator changes. Unlike the per-service demo
# seed (dev-only, in app code), this carries prod config such as the
# app-registry rows with same-origin MFE manifest URLs.
for db in ${DATABASES}; do
    seed_dir="/seed/${db}"
    if [ ! -d "${seed_dir}" ]; then
        continue
    fi
    if ! ls "${seed_dir}"/*.sql >/dev/null 2>&1; then
        continue
    fi
    for f in "${seed_dir}"/*.sql; do
        echo "  → seeding $(basename "${f}") into \`${db}\`"
        mysql_root "${db}" < "${f}"
    done
done

echo "✓ db-init complete"
