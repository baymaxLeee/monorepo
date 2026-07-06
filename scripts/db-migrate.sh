#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="${1:?Usage: db-migrate.sh <service-dir> [target-version]}"
TARGET_VERSION="${2:-}"

# Single shared Postgres instance: workflow DB + per-service business DBs +
# knowledge vectors all live here since the MySQL→PG consolidation (ADR 0029).
PG_CONTAINER_NAME="${POSTGRES_CONTAINER:-monorepo-workflow-postgres}"
PG_ADMIN_USER="${POSTGRES_ADMIN_USER:-${POSTGRES_USER:-workflow}}"
PG_ADMIN_PASSWORD="${POSTGRES_ADMIN_PASSWORD:-${POSTGRES_PASSWORD:-workflow}}"

service_database_name() {
  basename "$1" | tr '-' '_'
}

validate_version() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

version_key() {
  local version="${1#v}"
  local major minor patch
  IFS=. read -r major minor patch <<<"$version"
  printf "%010d.%010d.%010d" "$major" "$minor" "$patch"
}

version_gt() {
  [[ "$(version_key "$1")" > "$(version_key "$2")" ]]
}

version_le() {
  [[ "$(version_key "$1")" < "$(version_key "$2")" || "$(version_key "$1")" == "$(version_key "$2")" ]]
}

migration_version_from_file() {
  local name
  name="$(basename "$1")"
  if [[ "$name" =~ ^(v[0-9]+\.[0-9]+\.[0-9]+)\.sql$ ]]; then
    printf "%s" "${BASH_REMATCH[1]}"
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

if [ -n "$TARGET_VERSION" ] && ! validate_version "$TARGET_VERSION"; then
  echo "✗ target version must match v<major>.<minor>.<patch>: $TARGET_VERSION" >&2
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
  if [ "$DB" = "knowledge" ]; then
    pg_admin -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
  fi
  pg_service -d "$DB" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE IF NOT EXISTS migration (
  id smallint NOT NULL PRIMARY KEY,
  version varchar(32) NOT NULL,
  update_time timestamptz NOT NULL
);
INSERT INTO migration (id, version, update_time)
VALUES (1, 'v0.0.0', NOW())
ON CONFLICT (id) DO NOTHING;
SQL
}

read_current_version() {
  pg_service -d "$DB" -tA -c "SELECT version FROM migration WHERE id = 1;" | tail -n 1 | tr -d '[:space:]'
}

apply_migration() {
  local file="$1" version="$2"
  # DDL + version bump in ONE transaction (--single-transaction + ON_ERROR_STOP):
  # a failed migration rolls back both, so migration.version can never drift
  # ahead of the schema it claims to describe.
  {
    cat "$file"
    printf "\nUPDATE migration SET version = '%s', update_time = NOW() WHERE id = 1;\n" "$version"
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

MIGRATIONS=()
while IFS= read -r file; do
  version="$(migration_version_from_file "$file")"
  if [ -z "$version" ]; then
    echo "⚠ skipping migration with invalid filename: $file" >&2
    continue
  fi
  MIGRATIONS+=("$(version_key "$version") $version $file")
done < <(find "$VERSIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

if [ "${#MIGRATIONS[@]}" -eq 0 ]; then
  echo "✓ no valid migrations for $DB (current: $CURRENT_VERSION)"
  exit 0
fi

IFS=$'\n' MIGRATIONS=($(printf "%s\n" "${MIGRATIONS[@]}" | sort))
unset IFS

if [ -z "$TARGET_VERSION" ]; then
  TARGET_VERSION="$(printf "%s\n" "${MIGRATIONS[@]}" | tail -n 1 | awk '{print $2}')"
else
  target_found=false
  for migration in "${MIGRATIONS[@]}"; do
    version="$(awk '{print $2}' <<<"$migration")"
    if [ "$version" = "$TARGET_VERSION" ]; then
      target_found=true
      break
    fi
  done
  if [ "$target_found" != "true" ]; then
    echo "✗ target version has no local migration file: $TARGET_VERSION" >&2
    exit 1
  fi
fi

if version_gt "$CURRENT_VERSION" "$TARGET_VERSION"; then
  echo "✗ downgrade is not supported: current=$CURRENT_VERSION target=$TARGET_VERSION" >&2
  exit 1
fi

echo "→ migrating $DB: $CURRENT_VERSION -> $TARGET_VERSION"
for migration in "${MIGRATIONS[@]}"; do
  version="$(awk '{print $2}' <<<"$migration")"
  file="$(cut -d' ' -f3- <<<"$migration")"
  if version_gt "$version" "$CURRENT_VERSION" && version_le "$version" "$TARGET_VERSION"; then
    echo "  → applying $(basename "$file")"
    apply_migration "$file" "$version"
  fi
done

FINAL_VERSION="$(read_current_version)"
echo "✓ $DB migration.version = $FINAL_VERSION"
