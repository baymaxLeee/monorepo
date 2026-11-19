#!/usr/bin/env bash
set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$PKG_DIR/../../../.." && pwd)"
SCHEMA_DIR="$(cd "$PKG_DIR/../../../../schemas/openapi" && pwd)"
SERVICES=(iam admin chat knowledge telemetry canvas storage)
for service in "${SERVICES[@]}"; do
  schema="$SCHEMA_DIR/$service-server.json"
  if [ ! -f "$schema" ]; then
    echo "ERROR: schema missing: $schema (run backend OpenAPI export first)" >&2
    exit 1
  fi
done

STAGING_DIR="$(mktemp -d "$PKG_DIR/.codegen.XXXXXX")"
cleanup() {
  case "$STAGING_DIR" in
    "$PKG_DIR"/.codegen.*) rm -rf -- "$STAGING_DIR" ;;
    *) echo "ERROR: refusing to remove unexpected codegen staging path: $STAGING_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$STAGING_DIR/src"
cp "$PKG_DIR/src/orval-mutator.ts" "$STAGING_DIR/src/orval-mutator.ts"

cd "$PKG_DIR"
API_CODEGEN_PACKAGE_ROOT="$STAGING_DIR" pnpm exec orval --config orval.config.ts
API_CODEGEN_PACKAGE_ROOT="$STAGING_DIR" node scripts/finalize.mjs
pnpm --dir "$REPO_DIR" exec oxfmt --write "$STAGING_DIR/index.ts" "$STAGING_DIR/src/"*-server.ts

# Publish only after every client has generated, validated and formatted. Each
# same-filesystem rename replaces one live module without exposing a missing path
# to long-running Rspack watchers.
for service in "${SERVICES[@]}"; do
  mv -f "$STAGING_DIR/src/$service-server.ts" "$PKG_DIR/src/$service-server.ts"
done
mv -f "$STAGING_DIR/index.ts" "$PKG_DIR/index.ts"
