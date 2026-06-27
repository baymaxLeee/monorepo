#!/usr/bin/env bash
# Does NOT start Docker — run `just up` for MySQL/Redis/Workflow Postgres and schemas.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# pnpm treats CI=true as --frozen-lockfile (no lockfile updates). Local
# `just install` should reconcile package.json → lockfile; CI must stay frozen.
pnpm_install() {
  local dir="$1"
  if [ "${CI:-}" = "true" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
    (cd "$dir" && pnpm install --frozen-lockfile)
  else
    (cd "$dir" && pnpm install)
  fi
}

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
  pnpm_install apps/frontend
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
echo "── 5b. Backend Node services ──"
if command -v pnpm >/dev/null 2>&1; then
  for svc in chat; do
    if [ -f "apps/backend/services/$svc/package.json" ]; then
      echo "  → $svc"
      pnpm_install "apps/backend/services/$svc"
    fi
  done
else
  echo "  ✗ pnpm not found" >&2
  exit 1
fi

echo ""
echo "── 6. Local .env files (from .env.example if missing) ──"
for pair in \
  "apps/backend/services/admin/.env.example:apps/backend/services/admin/.env" \
  "apps/backend/services/chat/.env.example:apps/backend/services/chat/.env" \
  "apps/backend/services/knowledge/.env.example:apps/backend/services/knowledge/.env" \
  "apps/backend/services/telemetry/.env.example:apps/backend/services/telemetry/.env" \
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
