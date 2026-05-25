#!/usr/bin/env bash
# Install all workspace dependencies (tools + frontend + backend). Idempotent.
# Does NOT start Docker — run `just up` for MySQL/Redis and schema.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "── 1. Script permissions ──"
chmod +x scripts/*.sh 2>/dev/null || true
chmod +x apps/frontend/packages/api-client/scripts/*.sh 2>/dev/null || true

echo ""
echo "── 2. Tool versions (mise) ──"
if command -v mise >/dev/null 2>&1; then
  mise trust -q 2>/dev/null || mise trust
  mise install
else
  echo "  (mise not installed; skipping. https://mise.jdx.dev)"
fi

echo ""
echo "── 3. Frontend (pnpm workspace) ──"
if command -v pnpm >/dev/null 2>&1; then
  (cd apps/frontend && CI=true pnpm install)
else
  echo "  ✗ pnpm not found; install via mise or brew" >&2
  exit 1
fi

echo ""
echo "── 4. Backend Python (uv workspace) ──"
if command -v uv >/dev/null 2>&1; then
  (cd apps/backend && uv sync --all-packages)
else
  echo "  ✗ uv not found; install via mise or https://docs.astral.sh/uv/" >&2
  exit 1
fi

echo ""
echo "── 5. Backend Go services ──"
if command -v go >/dev/null 2>&1; then
  for svc in gateway iam; do
    echo "  → $svc"
    (cd "apps/backend/services/$svc" && go mod download && go mod tidy)
  done
else
  echo "  ✗ go not found; install via mise or https://go.dev/dl/" >&2
  exit 1
fi

echo ""
echo "── 6. Local .env files (from .env.example if missing) ──"
for pair in \
  "apps/backend/services/admin/.env.example:apps/backend/services/admin/.env" \
  "apps/backend/services/gateway/.env.example:apps/backend/services/gateway/.env" \
  "apps/backend/services/iam/.env.example:apps/backend/services/iam/.env"; do
  src="${pair%%:*}"
  dst="${pair##*:}"
  if [ -f "$src" ] && [ ! -f "$dst" ]; then
    cp "$src" "$dst"
    echo "  created $dst"
  fi
done

echo ""
echo "✓ All dependencies installed."
echo ""
echo "Next:"
echo "  just doctor  — verify toolchain"
echo "  just up      — Docker + database schema"
echo "  just dev     — start demo stack"
