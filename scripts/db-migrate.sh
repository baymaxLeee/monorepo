#!/usr/bin/env bash
set -euo pipefail
SERVICE_DIR="${1:?Usage: db-migrate.sh <service-dir> [target] [up|down]}"
TARGET_VERSION="${2:-}"
DIRECTION="${3:-up}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="$(basename "$SERVICE_DIR" | tr '-' '_')"
DB_USER="${DATABASE_USER:-$DB}"
DB_PASSWORD="${DATABASE_PASSWORD:-$DB}"
PG_CONTAINER_NAME="${POSTGRES_CONTAINER:-monorepo-postgres}"
PG_ADMIN_USER="${POSTGRES_ADMIN_USER:-${POSTGRES_USER:-workflow}}"
PG_ADMIN_PASSWORD="${POSTGRES_ADMIN_PASSWORD:-${POSTGRES_PASSWORD:-workflow}}"
PLAN_DIR="$(mktemp -d)"
CONTAINER_DIR=""
cleanup() {
  if [ -n "$CONTAINER_DIR" ]; then docker exec "$PG_CONTAINER_NAME" rm -rf "$CONTAINER_DIR" >/dev/null 2>&1 || true; fi
  rm -rf "$PLAN_DIR"
}
trap cleanup EXIT
build_binary() {
  local output="$1"
  if [ -d "$SERVICE_DIR/cmd/migrate" ]; then
    (cd "$SERVICE_DIR" && go build -o "$output" ./cmd/migrate)
  else
    (cd "$ROOT/scripts/dbmigrate" && GOWORK=off go build -o "$output" ./cmd/db-migrate)
  fi
}
BINARY="${DB_MIGRATE_BINARY:-}"
if [ -z "$BINARY" ]; then
  BINARY="$PLAN_DIR/db-migrate"
  build_binary "$BINARY"
fi
"$BINARY" validate "$SERVICE_DIR/migrations" "$TARGET_VERSION" "$DIRECTION"
pg_with_credentials() {
  local user="$1" password="$2"
  shift 2
  # Local dev reaches the container via `docker exec` (no host-mapped name);
  # the prod db-init image sets DB_MIGRATE_TRANSPORT=tcp to run psql straight
  # against the Postgres service, where no docker socket is available.
  if [ "${DB_MIGRATE_TRANSPORT:-docker}" = "tcp" ]; then
    PGPASSWORD="$password" psql -X -v ON_ERROR_STOP=1 \
      -h "${POSTGRES_HOST:-localhost}" -p "${POSTGRES_PORT:-5432}" -U "$user" "$@"
  else
    docker exec -i -e PGPASSWORD="$password" "$PG_CONTAINER_NAME" \
      psql -X -v ON_ERROR_STOP=1 -U "$user" "$@"
  fi
}

pg_admin() {
  pg_with_credentials "$PG_ADMIN_USER" "$PG_ADMIN_PASSWORD" "$@"
}

ensure_database() {
  pg_admin -d postgres --set=db_name="$DB" --set=db_user="$DB_USER" --set=db_password="$DB_PASSWORD" <<'SQL'
SELECT pg_advisory_lock(hashtext('service-database-bootstrap'), hashtext(:'db_name'));
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
}

if [ "${DB_MIGRATE_TRANSPORT:-docker}" = tcp ]; then
  if [ "$DIRECTION" = up ]; then ensure_database; fi
  PGHOST="${POSTGRES_HOST:-localhost}" PGPORT="${POSTGRES_PORT:-5432}" \
    PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD" PGDATABASE="$DB" \
    "$BINARY" run "$SERVICE_DIR/migrations" "$TARGET_VERSION" "$DIRECTION"
else
  LINUX_BINARY="${DB_MIGRATE_DOCKER_BINARY:-$PLAN_DIR/db-migrate-linux}"
  if [ -z "${DB_MIGRATE_DOCKER_BINARY:-}" ]; then
    arch="$(docker info --format '{{.Architecture}}')"
    case "$arch" in aarch64|arm64) arch=arm64 ;; x86_64|amd64) arch=amd64 ;; *) echo "Unsupported Docker architecture: $arch" >&2; exit 1 ;; esac
    GOOS=linux GOARCH="$arch" CGO_ENABLED=0 build_binary "$LINUX_BINARY"
  fi
  CONTAINER_DIR="$(docker exec "$PG_CONTAINER_NAME" mktemp -d /tmp/service-migration.XXXXXX)"
  docker cp "$LINUX_BINARY" "$PG_CONTAINER_NAME:$CONTAINER_DIR/db-migrate" >/dev/null
  docker cp "$SERVICE_DIR/migrations" "$PG_CONTAINER_NAME:$CONTAINER_DIR/migrations" >/dev/null
  if [ "$DIRECTION" = up ]; then ensure_database; fi
  docker exec -e PGHOST=127.0.0.1 -e PGUSER="$DB_USER" -e PGPASSWORD="$DB_PASSWORD" -e PGDATABASE="$DB" \
    "$PG_CONTAINER_NAME" "$CONTAINER_DIR/db-migrate" run "$CONTAINER_DIR/migrations" "$TARGET_VERSION" "$DIRECTION"
fi
