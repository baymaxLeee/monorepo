#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="${1:?Usage: db-migrate.sh <service-dir>}"
TARGET_VERSION="${2:-}"

# Single shared Postgres instance: workflow DB + per-service business DBs +
# knowledge vectors all live here since the MySQL→PG consolidation (ADR 0029).
PG_CONTAINER_NAME="${POSTGRES_CONTAINER:-monorepo-postgres}"
PG_ADMIN_USER="${POSTGRES_ADMIN_USER:-${POSTGRES_USER:-workflow}}"
PG_ADMIN_PASSWORD="${POSTGRES_ADMIN_PASSWORD:-${POSTGRES_PASSWORD:-workflow}}"

service_database_name() {
  basename "$1" | tr '-' '_'
}

validate_version() {
  [[ "$1" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] && [ "${#1}" -le 32 ]
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

MIGRATION_FILES=()
while IFS= read -r name; do
  validate_version "${name%.sql}" || { echo "✗ invalid migration filename: $name" >&2; exit 1; }
  MIGRATION_FILES+=("$VERSIONS_DIR/$name")
done < <(find "$VERSIONS_DIR" -maxdepth 1 -type f -name '*.sql' -exec basename {} \; | sort -t. -k1.2,1n -k2,2n -k3,3n)
if [ "${#MIGRATION_FILES[@]}" -eq 0 ] || [ "$(basename "${MIGRATION_FILES[0]}")" != "v1.0.0.sql" ]; then
  echo "✗ migration history must begin with v1.0.0.sql" >&2
  exit 1
fi
if [ -z "$TARGET_VERSION" ]; then
  TARGET_VERSION="$(basename "${MIGRATION_FILES[${#MIGRATION_FILES[@]}-1]}" .sql)"
fi
if ! validate_version "$TARGET_VERSION" || [ ! -f "$VERSIONS_DIR/$TARGET_VERSION.sql" ]; then
  echo "✗ unknown target version: $TARGET_VERSION" >&2
  exit 1
fi

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

pg_service() {
  pg_with_credentials "$DB_USER" "$DB_PASSWORD" "$@"
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

# Freeze the input before connecting, so a failed local read cannot apply half a plan.
PLAN_DIR="$(mktemp -d)"
trap 'rm -rf "$PLAN_DIR"' EXIT
PLAN_FILE="$PLAN_DIR/plan.sql"
for index in "${!MIGRATION_FILES[@]}"; do
  file="${MIGRATION_FILES[$index]}"
  cp "$file" "$PLAN_DIR/$(basename "$file")"
  MIGRATION_FILES[$index]="$PLAN_DIR/$(basename "$file")"
done
cat > "$PLAN_FILE" <<'SQL'
SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext('service-schema-migration'));
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE IF NOT EXISTS public.migration (
  id smallint NOT NULL PRIMARY KEY,
  version varchar(32) NOT NULL,
  checksum varchar(64) NOT NULL,
  update_time timestamptz NOT NULL
);
INSERT INTO public.migration (id, version, checksum, update_time)
VALUES (1, 'v0.0.0', '', NOW()) ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.migration_history (
  version varchar(32) PRIMARY KEY,
  checksum varchar(64) NOT NULL,
  applied_at timestamptz NOT NULL
);
CREATE TEMP TABLE migration_catalog (
  version varchar(32) PRIMARY KEY, checksum varchar(64) NOT NULL, ordinal integer NOT NULL
) ON COMMIT DROP;
SQL
ordinal=0
for file in "${MIGRATION_FILES[@]}"; do
  ordinal=$((ordinal + 1))
  version="$(basename "$file" .sql)"
  checksum="$(migration_checksum "$file")"
  printf "INSERT INTO pg_temp.migration_catalog VALUES ('%s', '%s', %d);\n" "$version" "$checksum" "$ordinal" >> "$PLAN_FILE"
done
cat >> "$PLAN_FILE" <<'SQL'
SELECT set_config('migration.target_version', :'target_version', true);
DO $validate$
DECLARE
  head public.migration%ROWTYPE;
  current_ordinal integer;
  target_ordinal integer;
BEGIN
  IF (SELECT count(*) FROM public.migration) <> 1 THEN
    RAISE EXCEPTION 'Invalid migration head: expected one row';
  END IF;
  SELECT * INTO STRICT head FROM public.migration WHERE id = 1;
  -- Adopt only the old verified baseline; never bless unknown versions or altered SQL.
  IF NOT EXISTS (SELECT 1 FROM public.migration_history) AND head.version = 'v1.0.0' THEN
    INSERT INTO public.migration_history VALUES (head.version, head.checksum, head.update_time);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.migration_history h LEFT JOIN pg_temp.migration_catalog c USING (version)
    WHERE c.version IS NULL OR c.checksum <> h.checksum
  ) THEN
    RAISE EXCEPTION 'Applied migration is missing or its checksum changed; restore the original migration file';
  END IF;
  IF head.version = 'v0.0.0' THEN
    current_ordinal := 0;
    IF head.checksum <> '' OR EXISTS (SELECT 1 FROM public.migration_history) THEN
      RAISE EXCEPTION 'Migration head and history disagree';
    END IF;
  ELSE
    SELECT ordinal INTO current_ordinal FROM pg_temp.migration_catalog WHERE version = head.version;
    IF current_ordinal IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.migration_history WHERE version = head.version AND checksum = head.checksum
    ) THEN
      RAISE EXCEPTION 'Unknown migration head or checksum mismatch: %', head.version;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.migration_catalog c LEFT JOIN public.migration_history h USING (version)
    WHERE (c.ordinal <= current_ordinal AND h.version IS NULL)
       OR (c.ordinal > current_ordinal AND h.version IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Migration history has a gap or an out-of-order version';
  END IF;
  SELECT ordinal INTO STRICT target_ordinal FROM pg_temp.migration_catalog
  WHERE version = current_setting('migration.target_version');
  IF target_ordinal < current_ordinal THEN
    RAISE EXCEPTION 'Schema downgrade is not automatic; use a reviewed forward repair or a verified restore';
  END IF;
END
$validate$;
SQL
for file in "${MIGRATION_FILES[@]}"; do
  version="$(basename "$file" .sql)"
  checksum="$(migration_checksum "$file")"
  printf "SELECT NOT EXISTS (SELECT 1 FROM public.migration_history WHERE version = '%s') AS apply_migration \\gset\n" "$version" >> "$PLAN_FILE"
  printf '\\if :apply_migration\n\\echo Applying %s\n' "$version" >> "$PLAN_FILE"
  cat "$file" >> "$PLAN_FILE"
  printf "\nINSERT INTO public.migration_history VALUES ('%s', '%s', NOW());\n" "$version" "$checksum" >> "$PLAN_FILE"
  printf "UPDATE public.migration SET version = '%s', checksum = '%s', update_time = NOW() WHERE id = 1;\n" "$version" "$checksum" >> "$PLAN_FILE"
  printf '\\endif\n' >> "$PLAN_FILE"
  if [ "$version" = "$TARGET_VERSION" ]; then break; fi
done

echo "→ preparing database: $DB"
ensure_database
# DDL, data changes and all pending history entries commit together. The database
# lock also serializes concurrent deploys before they inspect the current head.
pg_service -d "$DB" --single-transaction --set=target_version="$TARGET_VERSION" -f - < "$PLAN_FILE"
echo "✓ $DB migration.version = $TARGET_VERSION (all applied checksums verified)"
