#!/usr/bin/env bash
# Build the frontend for static hosting (Cloudflare Pages, OSS, S3, etc.).
#
# APP selects any workspace under apps/frontend/apps (default: platform).
#
# Required env (consumed by rspack DefinePlugin at build time, baked into
# the bundle):
# Platform consumes API_BASE_URL, APP_RELEASE, and optionally TELEMETRY_ENDPOINT.
# Remotes need no build-time platform wiring; their publicPath is resolved from
# the manifest URL registered through the admin app registry.
#
# Cloudflare Pages typical config:
#   Build command:   bash scripts/build-frontend-static.sh
#   Output dir:      apps/frontend/apps/platform/dist
#   Env vars:        APP=platform (default) + the platform variables above
#                    Create one additional project or asset target per remote,
#                    setting APP to its workspace name.
set -euo pipefail

APP="${APP:-platform}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

APP_DIR="$ROOT/apps/frontend/apps/$APP"
if [ ! -f "$APP_DIR/package.json" ]; then
  echo "✗ unknown frontend app: $APP" >&2
  exit 1
fi

echo "→ building frontend app: ${APP}"
cd "${ROOT}/apps/frontend"

# Corepack uses the repository root packageManager declaration.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "→ pnpm not on PATH, enabling via corepack..."
  corepack enable
  corepack prepare --activate
fi

# --frozen-lockfile to guarantee reproducible builds.
pnpm install --frozen-lockfile

NODE_ENV=production pnpm -F "${APP}" build

DIST="$APP_DIR/dist"
echo ""
echo "✓ built ${APP} → ${DIST}"
ls -la "${DIST}" | head -20

# Sanity check: ensure no stray localhost URL leaked into the prod bundle.
if grep -rl "localhost" "${DIST}" 2>/dev/null | grep -v '\.map$' | head -3; then
  echo ""
  echo "::warning::Found 'localhost' references in built assets — review above."
fi
