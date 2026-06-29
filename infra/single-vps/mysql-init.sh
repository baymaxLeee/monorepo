#!/bin/sh
# One-shot DB init for the single-VPS profile.
#
# Runs inside a mysql:8.4 container (which gives us the `mysql` CLI).
# Connects to the `mysql` service via Docker network DNS, creates each
# service database, grants APP_USER, then applies pending *.sql files under
# /schema/<db>/ in lexicographic order. Each service records its applied
# version in a `migration` table; files at or below that version are skipped.
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
    MYSQL_PWD="${ROOT_PASS}" mysql --default-character-set=utf8mb4 -h "${HOST}" -uroot "$@"
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
DATABASES="iam admin chat gateway knowledge telemetry"

for db in ${DATABASES}; do
    echo "→ ensuring database \`${db}\` exists and APP_USER \`${APP_USER}\` has access"
    mysql_root -e "
        CREATE DATABASE IF NOT EXISTS \`${db}\`
            CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
        GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${APP_USER}'@'%';
    "
done

mysql_root -e "FLUSH PRIVILEGES;"

# Read the semver recorded by the service's migration runner. Returns v0.0.0
# when the table does not exist yet (fresh database).
db_version() {
    _db="$1"
    if ! mysql_root -N -e "
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = '${_db}' AND table_name = 'migration'
        LIMIT 1
    " >/dev/null 2>&1; then
        echo "v0.0.0"
        return
    fi
    _ver="$(mysql_root -N -e "SELECT version FROM \`${_db}\`.migration WHERE id = 1 LIMIT 1" 2>/dev/null || true)"
    if [ -z "${_ver}" ]; then
        echo "v0.0.0"
    else
        echo "${_ver}"
    fi
}

# True when $1 is strictly newer than $2 (v1.3.1 > v1.3.0).
version_gt() {
    _newer="$(printf '%s\n%s\n' "$2" "$1" | sort -V | tail -1)"
    [ "${_newer}" = "$1" ] && [ "$1" != "$2" ]
}

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
    applied="$(db_version "${db}")"
    for f in "${schema_dir}"/*.sql; do
        file_ver="$(basename "${f}" .sql)"
        if ! version_gt "${file_ver}" "${applied}"; then
            echo "  → skipping $(basename "${f}") (\`${db}\` at ${applied})"
            continue
        fi
        echo "  → applying $(basename "${f}") to \`${db}\`"
        mysql_root "${db}" < "${f}"
        applied="$(db_version "${db}")"
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
