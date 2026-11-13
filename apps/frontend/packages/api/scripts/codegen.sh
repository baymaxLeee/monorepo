#!/usr/bin/env bash
set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$PKG_DIR/../../../.." && pwd)"
SCHEMA_DIR="$(cd "$PKG_DIR/../../../../schemas/openapi" && pwd)"
for service in iam admin chat knowledge telemetry canvas storage; do
  schema="$SCHEMA_DIR/$service-server.json"
  if [ ! -f "$schema" ]; then
    echo "ERROR: schema missing: $schema (run backend OpenAPI export first)" >&2
    exit 1
  fi
done

rm -rf "$PKG_DIR/generated"
mkdir -p "$PKG_DIR/src"
for service in iam admin chat knowledge telemetry canvas storage; do
  rm -f "$PKG_DIR/src/$service-server.ts"
done

cd "$PKG_DIR"
pnpm exec orval --config orval.config.ts
node scripts/finalize.mjs
pnpm --dir "$REPO_DIR" exec oxfmt --write "$PKG_DIR/index.ts" "$PKG_DIR/src/"*-server.ts
