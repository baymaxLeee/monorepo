#!/usr/bin/env bash
set -euo pipefail

# Generates TS clients for each backend service from schemas/openapi/*.json
# Run via:  cd apps/frontend && just gen-client  (or `just sync` from root)

SCHEMA_DIR="$(cd "$(dirname "$0")/../../../../../schemas/openapi" && pwd)"
PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$SCHEMA_DIR" ]; then
  echo "✗ schema dir not found: $SCHEMA_DIR" >&2
  exit 1
fi

SERVICES=("bot")  # Add new services here

for svc in "${SERVICES[@]}"; do
  SCHEMA="$SCHEMA_DIR/$svc.json"
  if [ ! -f "$SCHEMA" ]; then
    echo "⚠ schema missing for $svc: $SCHEMA (run backend gen-openapi first)" >&2
    continue
  fi
  OUT="$PKG_DIR/$svc/generated"
  mkdir -p "$OUT"
  npx -y openapi-typescript@7 "$SCHEMA" -o "$OUT/schema.d.ts"
  echo "✓ $svc/generated/schema.d.ts"
done
