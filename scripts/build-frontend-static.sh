#!/usr/bin/env bash
# Build the frontend for static hosting (Cloudflare Pages, OSS, S3, etc.).
#
# Build target:
#   APP=platform   (default) → builds the host shell
#   APP=admin                → builds the mfe-admin remote
#
# Required env (consumed by rspack DefinePlugin at build time, baked into
# the bundle):
#   APP=platform requires:
#     API_BASE_URL       https://api.your-domain.com
#     MFE_ADMIN_ENTRY    mfe_admin@https://mfe-admin.your-domain.com/mf-manifest.json
#                        (or wherever you deploy the admin remote)
#     APP_RELEASE        a git sha or semver — shown in telemetry
#     TELEMETRY_ENDPOINT (optional, defaults to "/api/telemetry-server/rum/batch"
#                         which is then prefixed with API_BASE_URL at runtime)
#   APP=admin requires:
#     (none — admin remote uses publicPath: "auto", asset URLs are inferred
#      from the host bundle's resolved manifest URL)
#
# Cloudflare Pages typical config:
#   Build command:   bash scripts/build-frontend-static.sh
#   Output dir:      apps/frontend/apps/platform/dist
#   Env vars:        APP=platform (default) + the four above
#                    For the admin remote, create a SECOND Pages project with:
#                    Build command: APP=admin bash scripts/build-frontend-static.sh
#                    Output dir:    apps/frontend/apps/admin/dist
set -euo pipefail

APP="${APP:-platform}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "$APP" in
  platform|admin) ;;
  *) echo "✗ unknown APP=$APP (expected: platform|admin)" >&2; exit 1 ;;
esac

echo "→ building frontend app: ${APP}"
cd "${ROOT}/apps/frontend"

# pnpm is required. CI providers (Cloudflare Pages, GitHub Actions) all have
# node + corepack; we enable corepack to get the pnpm version pinned by
# package.json's packageManager field.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "→ pnpm not on PATH, enabling via corepack..."
  corepack enable
  corepack prepare --activate
fi

# --frozen-lockfile to guarantee reproducible builds.
pnpm install --frozen-lockfile

NODE_ENV=production pnpm -F "${APP}" build

DIST="${ROOT}/apps/frontend/apps/${APP}/dist"
echo ""
echo "✓ built ${APP} → ${DIST}"
ls -la "${DIST}" | head -20

# Sanity check: ensure no stray localhost URL leaked into the prod bundle.
if grep -rl "localhost" "${DIST}" 2>/dev/null | grep -v '\.map$' | head -3; then
  echo ""
  echo "::warning::Found 'localhost' references in built assets — review above."
fi
