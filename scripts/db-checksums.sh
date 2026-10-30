#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:?Usage: db-checksums.sh <check|write> [service] [version]}"
case "$MODE" in check|write) ;; *) echo 'Unknown checksum command' >&2; exit 1 ;; esac
if [ "$MODE" = write ]; then
  [[ "${2:-}" =~ ^[a-z][a-z0-9-]*$ ]] && [[ "${3:-}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Service and version are required' >&2; exit 1; }
fi
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
(cd "$ROOT/scripts/dbmigrate" && GOWORK=off go build -o "$TEMP_DIR/db-migrate" ./cmd/db-migrate)
if [ "$MODE" = write ]; then
  "$TEMP_DIR/db-migrate" checksums-write "$ROOT/apps/backend/services/$2/migrations/$3"
else
  found=false
  for dir in "$ROOT"/apps/backend/services/*/migrations; do
    [ -d "$dir" ] || continue
    "$TEMP_DIR/db-migrate" checksums-check "$dir"
    found=true
  done
  [ "$found" = true ] || { echo 'No migration directories found' >&2; exit 1; }
  echo 'Migration checksum manifests verified.'
fi
