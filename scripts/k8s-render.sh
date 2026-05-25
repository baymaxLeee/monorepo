#!/usr/bin/env bash
# Render K8s manifests for an environment overlay to stdout. Used for
# code-review of deploy changes and local dry-runs before pushing.
#
# Usage:
#   scripts/k8s-render.sh dev
#   scripts/k8s-render.sh prod
#   scripts/k8s-render.sh prod | kubectl apply -f - --dry-run=server
set -euo pipefail

ENV="${1:-}"
if [ -z "$ENV" ]; then
  echo "usage: $0 <dev|prod>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERLAY="$ROOT/infra/k8s/overlays/$ENV"

if [ ! -d "$OVERLAY" ]; then
  echo "no overlay at $OVERLAY" >&2
  exit 1
fi

# --load-restrictor=LoadRestrictionsNone allows the observability base to
# reference ClickHouse init.sql from infra/observability/ (shared with
# docker-compose).
exec kubectl kustomize --load-restrictor=LoadRestrictionsNone "$OVERLAY"
