#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="${1:?Usage: db-migrate.sh <service-dir> [target-version]}"
TARGET_VERSION="${2:-}"

# Engine selection: a service opts into Postgres with a `migrations/engine`
# marker file containing "postgres"; everything else defaults to MySQL.
ENGINE="mysql"
if [ -f "$SERVICE_DIR/migrations/engine" ]; then
  ENGINE="$(tr -d '[:space:]' < "$SERVICE_DIR/migrations/engine")"
fi

# MySQL connection (shared business instance)
MYSQL_CONTAINER_NAME="${MYSQL_CONTAINER:-monorepo-mysql}"
MYSQL_APP_USER="${MYSQL_USER:-dev}"
MYSQL_ROOT_USER_NAME="${MYSQL_ROOT_USER:-root}"
MYSQL_ROOT_PASS="${MYSQL_ROOT_PASSWORD:-dev}"

# Postgres connection (shared instance: workflow DB + knowledge DB)
PG_CONTAINER_NAME="${POSTGRES_CONTAINER:-monorepo-workflow-postgres}"
PG_USER_NAME="${POSTGRES_USER:-workflow}"
PG_PASSWORD_VALUE="${POSTGRES_PASSWORD:-workflow}"

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
VERSIONS_DIR="$SERVICE_DIR/migrations/versions"

if [ ! -d "$VERSIONS_DIR" ]; then
  echo "⚠ migrations directory missing: $VERSIONS_DIR" >&2
  exit 1
fi

if [ -n "$TARGET_VERSION" ] && ! validate_version "$TARGET_VERSION"; then
  echo "✗ target version must match v<major>.<minor>.<patch>: $TARGET_VERSION" >&2
  exit 1
fi

# ── engine-specific primitives ─────────────────────────────────────────
mysql_root() {
  docker exec -i "$MYSQL_CONTAINER_NAME" mysql -u"$MYSQL_ROOT_USER_NAME" -p"$MYSQL_ROOT_PASS" "$@"
}

pg() {
  docker exec -i -e PGPASSWORD="$PG_PASSWORD_VALUE" "$PG_CONTAINER_NAME" \
    psql -v ON_ERROR_STOP=1 -U "$PG_USER_NAME" "$@"
}

ensure_db_and_migration_table() {
  if [ "$ENGINE" = "postgres" ]; then
    if ! pg -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB';" | grep -q 1; then
      pg -d postgres -c "CREATE DATABASE \"$DB\";"
    fi
    pg -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS vector;"
    pg -d "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS migration (
  id smallint NOT NULL PRIMARY KEY,
  version varchar(32) NOT NULL,
  update_time timestamptz NOT NULL
);
INSERT INTO migration (id, version, update_time)
VALUES (1, 'v0.0.0', NOW())
ON CONFLICT (id) DO NOTHING;
SQL
  else
    mysql_root -e "CREATE DATABASE IF NOT EXISTS \`$DB\`; GRANT ALL PRIVILEGES ON \`$DB\`.* TO '$MYSQL_APP_USER'@'%'; FLUSH PRIVILEGES;"
    mysql_root "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS `migration` (
  `id` TINYINT NOT NULL COMMENT '主键, 只允许为 1',
  `version` VARCHAR(32) NOT NULL COMMENT '当前数据库表结构版本',
  `update_time` DATETIME NOT NULL COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `migration` (`id`, `version`, `update_time`)
VALUES (1, 'v0.0.0', NOW());
SQL
  fi
}

read_current_version() {
  if [ "$ENGINE" = "postgres" ]; then
    pg -d "$DB" -tA -c "SELECT version FROM migration WHERE id = 1;" | tail -n 1 | tr -d '[:space:]'
  else
    mysql_root "$DB" -N -B -e "SELECT version FROM migration WHERE id = 1;" | tail -n 1
  fi
}

apply_migration_file() {
  if [ "$ENGINE" = "postgres" ]; then
    pg -d "$DB" < "$1"
  else
    mysql_root "$DB" < "$1"
  fi
}

set_migration_version() {
  if [ "$ENGINE" = "postgres" ]; then
    pg -d "$DB" -c "UPDATE migration SET version = '$1', update_time = NOW() WHERE id = 1;"
  else
    mysql_root "$DB" -e "UPDATE migration SET version = '$1', update_time = NOW() WHERE id = 1;"
  fi
}

# ── shared migration flow ──────────────────────────────────────────────
echo "→ ($ENGINE) preparing database: $DB"
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
    apply_migration_file "$file"
    set_migration_version "$version"
  fi
done

FINAL_VERSION="$(read_current_version)"
echo "✓ $DB migration.version = $FINAL_VERSION"
