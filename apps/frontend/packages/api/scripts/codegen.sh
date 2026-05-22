#!/usr/bin/env bash
set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA_DIR="$(cd "$PKG_DIR/../../../../schemas/openapi" && pwd)"

if [ ! -f "$SCHEMA_DIR/admin-server.json" ]; then
  echo "⚠ schema missing: $SCHEMA_DIR/admin-server.json (run backend OpenAPI export first)" >&2
  exit 0
fi

cd "$PKG_DIR"
pnpm exec orval --config orval.config.ts
