#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="${1:?Usage: db-migrate.sh <service-dir>}"
TARGET_VERSION="${2:-v1.0.0}"

# Single shared Postgres instance: workflow DB + per-service business DBs +
# knowledge vectors all live here since the MySQL→PG consolidation (ADR 0029).
PG_CONTAINER_NAME="${POSTGRES_CONTAINER:-monorepo-postgres}"
PG_ADMIN_USER="${POSTGRES_ADMIN_USER:-${POSTGRES_USER:-workflow}}"
PG_ADMIN_PASSWORD="${POSTGRES_ADMIN_PASSWORD:-${POSTGRES_PASSWORD:-workflow}}"

service_database_name() {
  basename "$1" | tr '-' '_'
}

validate_version() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

migration_checksum() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  fi
}

DB="$(service_database_name "$SERVICE_DIR")"
DB_USER="${DATABASE_USER:-$DB}"
DB_PASSWORD="${DATABASE_PASSWORD:-$DB}"
VERSIONS_DIR="$SERVICE_DIR/migrations/versions"

if [ ! -d "$VERSIONS_DIR" ]; then
  echo "⚠ migrations directory missing: $VERSIONS_DIR" >&2
  exit 1
fi

if [ "$TARGET_VERSION" != "v1.0.0" ]; then
  echo "✗ only the reinstall-only v1.0.0 baseline is supported: $TARGET_VERSION" >&2
  exit 1
fi

pg_with_credentials() {
  local user="$1" password="$2"
  shift 2
  # Local dev reaches the container via `docker exec` (no host-mapped name);
  # the prod db-init image sets DB_MIGRATE_TRANSPORT=tcp to run psql straight
  # against the Postgres service, where no docker socket is available.
  if [ "${DB_MIGRATE_TRANSPORT:-docker}" = "tcp" ]; then
    PGPASSWORD="$password" psql -v ON_ERROR_STOP=1 \
      -h "${POSTGRES_HOST:-localhost}" -p "${POSTGRES_PORT:-5432}" -U "$user" "$@"
  else
    docker exec -i -e PGPASSWORD="$password" "$PG_CONTAINER_NAME" \
      psql -v ON_ERROR_STOP=1 -U "$user" "$@"
  fi
}

pg_admin() {
  pg_with_credentials "$PG_ADMIN_USER" "$PG_ADMIN_PASSWORD" "$@"
}

pg_service() {
  pg_with_credentials "$DB_USER" "$DB_PASSWORD" "$@"
}

ensure_db_and_migration_table() {
  pg_admin -d postgres --set=db_name="$DB" --set=db_user="$DB_USER" --set=db_password="$DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db_name', :'db_user') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db_name', :'db_user') \gexec
SQL
  # Extensions are not grantable to DB owners on stock Postgres images, so the
  # bootstrap installs them before the service-owned baseline runs.
  if [ "$DB" = "knowledge" ] || [ "$DB" = "chat" ]; then
    pg_admin -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
  fi
  pg_service -d "$DB" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE IF NOT EXISTS migration (
  id smallint NOT NULL PRIMARY KEY,
  version varchar(32) NOT NULL,
  checksum varchar(64) NOT NULL,
  update_time timestamptz NOT NULL
);
INSERT INTO migration (id, version, checksum, update_time)
VALUES (1, 'v0.0.0', '', NOW())
ON CONFLICT (id) DO NOTHING;
SQL
}

read_current_version() {
  pg_service -d "$DB" -tA -c "SELECT version FROM migration WHERE id = 1;" | tail -n 1 | tr -d '[:space:]'
}

read_current_checksum() {
  pg_service -d "$DB" -tA -c "SELECT checksum FROM migration WHERE id = 1;" | tail -n 1 | tr -d '[:space:]'
}

migration_has_checksum() {
  [ "$(pg_service -d "$DB" -tA -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'migration' AND column_name = 'checksum');" | tail -n 1 | tr -d '[:space:]')" = "t" ]
}

apply_migration() {
  local file="$1" version="$2"
  local checksum
  checksum="$(migration_checksum "$file")"
  # DDL + version bump in ONE transaction (--single-transaction + ON_ERROR_STOP):
  # a failed migration rolls back both, so migration.version can never drift
  # ahead of the schema it claims to describe.
  {
    cat "$file"
    printf "\nUPDATE public.migration SET version = '%s', checksum = '%s', update_time = NOW() WHERE id = 1;\n" "$version" "$checksum"
  } | pg_service -d "$DB" --single-transaction
}

# ── migration flow ─────────────────────────────────────────────────────
echo "→ preparing database: $DB"
ensure_db_and_migration_table

CURRENT_VERSION="$(read_current_version)"
if ! validate_version "$CURRENT_VERSION"; then
  echo "✗ invalid current migration.version in $DB: $CURRENT_VERSION" >&2
  exit 1
fi
if ! migration_has_checksum; then
  echo "✗ legacy migration state has no baseline checksum for $DB" >&2
  echo "  No in-place data migration is supported; run 'just reset-demo-data'." >&2
  exit 1
fi

MIGRATION_FILES=()
while IFS= read -r file; do
  MIGRATION_FILES+=("$file")
done < <(find "$VERSIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
TARGET_FILE="$VERSIONS_DIR/v1.0.0.sql"
if [ "${#MIGRATION_FILES[@]}" -ne 1 ] || [ "${MIGRATION_FILES[0]}" != "$TARGET_FILE" ]; then
  echo "✗ $DB must own exactly one migration: $TARGET_FILE" >&2
  exit 1
fi

if [ "$CURRENT_VERSION" != "v0.0.0" ] && [ "$CURRENT_VERSION" != "$TARGET_VERSION" ]; then
  echo "✗ incompatible migration history: current=$CURRENT_VERSION target=$TARGET_VERSION" >&2
  echo "  No upgrade or downgrade path exists; run 'just reset-demo-data'." >&2
  exit 1
fi

if [ "$CURRENT_VERSION" = "$TARGET_VERSION" ]; then
  CURRENT_CHECKSUM="$(read_current_checksum)"
  TARGET_CHECKSUM="$(migration_checksum "$TARGET_FILE")"
  if [ "$CURRENT_CHECKSUM" != "$TARGET_CHECKSUM" ]; then
    echo "✗ baseline checksum changed for $DB at $TARGET_VERSION" >&2
    echo "  No in-place data migration is supported; run 'just reset-demo-data'." >&2
    exit 1
  fi
  echo "✓ $DB migration.version = $CURRENT_VERSION (baseline checksum matches)"
  exit 0
fi

echo "→ migrating $DB: $CURRENT_VERSION -> $TARGET_VERSION"
echo "  → applying $(basename "$TARGET_FILE")"
apply_migration "$TARGET_FILE" "$TARGET_VERSION"

FINAL_VERSION="$(read_current_version)"
FINAL_CHECKSUM="$(read_current_checksum)"
EXPECTED_CHECKSUM="$(migration_checksum "$TARGET_FILE")"
if [ "$FINAL_VERSION" != "$TARGET_VERSION" ] || [ "$FINAL_CHECKSUM" != "$EXPECTED_CHECKSUM" ]; then
  echo "✗ migration state mismatch for $DB: version=$FINAL_VERSION checksum=$FINAL_CHECKSUM" >&2
  exit 1
fi
echo "✓ $DB migration.version = $FINAL_VERSION"
