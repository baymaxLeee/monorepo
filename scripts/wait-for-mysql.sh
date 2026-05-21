#!/usr/bin/env bash
set -euo pipefail
echo "→ Waiting for MySQL..."
CONTAINER="${MYSQL_CONTAINER:-monorepo-mysql}"
ROOT_USER="${MYSQL_ROOT_USER:-root}"
ROOT_PASS="${MYSQL_ROOT_PASSWORD:-dev}"

until docker exec "$CONTAINER" mysqladmin ping -h 127.0.0.1 -u"$ROOT_USER" -p"$ROOT_PASS" --silent 2>/dev/null; do
  sleep 1
done
