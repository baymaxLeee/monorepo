#!/usr/bin/env bash
# One-shot bootstrap. Idempotent.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "── 1. Tools ──"
if command -v mise >/dev/null 2>&1; then
  mise install
else
  echo "  (mise not installed; skipping. Get it at https://mise.jdx.dev)"
fi

echo ""
echo "── 2. Frontend ──"
if command -v pnpm >/dev/null 2>&1; then
  (cd apps/frontend && pnpm install)
else
  echo "  pnpm not found; skipping frontend deps"
fi

echo ""
echo "── 3. Backend (Python) ──"
if command -v uv >/dev/null 2>&1; then
  (cd apps/backend && uv sync --all-packages)
else
  echo "  uv not found; skipping backend Python deps"
fi

echo ""
echo "── 4. Backend (Go) ──"
if command -v go >/dev/null 2>&1; then
  (cd apps/backend/services/api-gateway && go mod tidy)
else
  echo "  go not found; skipping Go deps"
fi

echo ""
echo "── 5. Infra ──"
if command -v docker >/dev/null 2>&1; then
  docker compose up -d
else
  echo "  docker not found; please install to run local Postgres/Redis"
fi

echo ""
echo "✓ Bootstrap complete."
echo ""
echo "Next:"
echo "  just doctor  — verify everything"
echo "  just dev     — see how to run the demo stack"
