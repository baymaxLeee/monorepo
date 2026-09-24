#!/usr/bin/env bash
# Destroy and recreate every local service database and Asset byte store.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSET_DATA_DIR="$ROOT/apps/backend/services/asset/data"

if [ -e "$ASSET_DATA_DIR" ]; then
  echo "→ resetting local Asset bytes: $ASSET_DATA_DIR"
  find "$ASSET_DATA_DIR" -mindepth 1 -delete
fi

RESET_DEMO_DATA=true "$ROOT/scripts/db-bootstrap.sh"
