#!/usr/bin/env bash
# Destroy and recreate every local service database and Storage byte store.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORAGE_DATA_DIR="$ROOT/apps/backend/services/storage/data"

if [ -e "$STORAGE_DATA_DIR" ]; then
  echo "→ resetting local Storage bytes: $STORAGE_DATA_DIR"
  find "$STORAGE_DATA_DIR" -mindepth 1 -delete
fi

RESET_DEMO_DATA=true "$ROOT/scripts/db-bootstrap.sh"
