#!/usr/bin/env bash
# Apply service-owned MySQL migrations by semantic version.
set -euo pipefail

SERVICE_DIR="${1:?Usage: db-migrate.sh <service-dir> [target-version]}"
TARGET_VERSION="${2:-}"
CONTAINER="${MYSQL_CONTAINER:-monorepo-mysql}"
APP_USER="${MYSQL_USER:-dev}"
ROOT_USER="${MYSQL_ROOT_USER:-root}"
ROOT_PASS="${MYSQL_ROOT_PASSWORD:-dev}"

service_database_name() {
  basename "$1" | tr '-' '_'
}

mysql_root() {
  docker exec -i "$CONTAINER" mysql -u"$ROOT_USER" -p"$ROOT_PASS" "$@"
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
  if [[ "$name" =~ ^(v[0-9]+\.[0-9]+\.[0-9]+)(__.+)?\.sql$ ]]; then
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

mysql_root -e "CREATE DATABASE IF NOT EXISTS \`$DB\`; GRANT ALL PRIVILEGES ON \`$DB\`.* TO '$APP_USER'@'%'; FLUSH PRIVILEGES;"
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

CURRENT_VERSION="$(mysql_root "$DB" -N -B -e "SELECT version FROM migration WHERE id = 1;" | tail -n 1)"
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
    mysql_root "$DB" < "$file"
    mysql_root "$DB" -e "UPDATE migration SET version = '$version', update_time = NOW() WHERE id = 1;"
  fi
done

FINAL_VERSION="$(mysql_root "$DB" -N -B -e "SELECT version FROM migration WHERE id = 1;" | tail -n 1)"
echo "✓ $DB migration.version = $FINAL_VERSION"
