#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "$TARGET" ]; then
  just build-frontend
  just build-backend
  exit 0
fi

case "$TARGET" in
  frontend) just build-frontend ;;
  backend) just build-backend ;;
  *)
    if [ -d "apps/frontend/apps/$TARGET" ]; then
      cd apps/frontend && just build "$TARGET"
    elif [ -d "apps/backend/services/$TARGET" ]; then
      cd apps/backend && just build "$TARGET"
    else
      echo "Unknown build target: $TARGET" >&2
      exit 1
    fi
    ;;
esac
