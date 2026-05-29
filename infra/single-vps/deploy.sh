#!/usr/bin/env bash
# Deploy / update the single-VPS stack from a local checkout.
#
# What it does:
#   1. Validates local .env exists
#   2. rsync's infra/single-vps/ (compose.yml + mysql-init helper script)
#      to the VPS at /opt/monorepo/
#   3. SSH's in and runs `docker compose pull && docker compose up -d`
#   4. Waits for /healthz to return 200
#
# Usage:
#   ./infra/single-vps/deploy.sh <user>@<vps-ip>
#   ./infra/single-vps/deploy.sh root@1.2.3.4
#
# Prereqs:
#   - infra/single-vps/.env exists locally (copy .env.example, fill values)
#   - VPS has been bootstrapped (see bootstrap.sh)
#   - SSH key auth set up (we don't prompt for passwords)
#   - GHCR images for IMAGE_TAG have been built and pushed
#
# Env (optional overrides):
#   DEPLOY_DIR   — remote path (default: /opt/monorepo)
#   PUBLIC_PORT  — health-check port (default: read from .env)

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <user>@<host>" >&2
    echo "Example: $0 root@1.2.3.4" >&2
    exit 1
fi

REMOTE="$1"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/monorepo}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# ── 1. preflight ─────────────────────────────────────────────────
ENV_FILE="${HERE}/.env"
if [ ! -f "${ENV_FILE}" ]; then
    echo "✗ ${ENV_FILE} missing." >&2
    echo "  Copy infra/single-vps/.env.example → infra/single-vps/.env and fill in." >&2
    exit 1
fi

# Check every required key is present + non-empty. Failing here is much
# nicer than letting `docker compose pull` blow up on the remote with a
# cryptic "required variable X is missing a value" message. When the
# compose file grows a new `${KEY:?...}` reference, append the key here.
required_keys=(
    IMAGE_REGISTRY
    IMAGE_TAG
    PUBLIC_PORT
    MYSQL_ROOT_PASSWORD
    MYSQL_USER
    MYSQL_PASSWORD
    ACCESS_TOKEN_SECRET
    SUPER_ADMIN_ACCOUNT
    SUPER_ADMIN_EMAIL
    SUPER_ADMIN_PASSWORD
    ADMIN_SECRET_KEY
    INTERNAL_API_TOKEN
)
missing=()
for key in "${required_keys[@]}"; do
    if ! grep -qE "^${key}=[^[:space:]\"']*[^[:space:]\"'#]" "${ENV_FILE}"; then
        missing+=("${key}")
    fi
done
if [ "${#missing[@]}" -gt 0 ]; then
    echo "✗ ${ENV_FILE} is missing required keys:" >&2
    for k in "${missing[@]}"; do echo "    - ${k}" >&2; done
    echo "" >&2
    echo "  See infra/single-vps/.env.example for the template + the command to" >&2
    echo "  generate each value (e.g. Fernet for ADMIN_SECRET_KEY)." >&2
    exit 1
fi

# Read PUBLIC_PORT from .env for the post-deploy health check.
PUBLIC_PORT="$(grep -E '^PUBLIC_PORT=' "${ENV_FILE}" | tail -1 | cut -d= -f2 | tr -d '"' || true)"
PUBLIC_PORT="${PUBLIC_PORT:-8080}"

# Extract just the host part of REMOTE for the curl probe.
REMOTE_HOST="${REMOTE#*@}"

# ── 2. ship the deploy artifacts ─────────────────────────────────
echo "→ syncing infra/single-vps → ${REMOTE}:${DEPLOY_DIR}"
ssh "${REMOTE}" "mkdir -p ${DEPLOY_DIR}"

# We ONLY ship the small ops directory. All actual code (including the
# nginx.conf and mysql-init.sh scripts) is baked into container images
# pulled from the registry. Excludes:
#   .env.example — template only, the real .env is below
rsync -avz --delete \
    --include='docker-compose.prod.yml' \
    --include='README.md' \
    --exclude='*' \
    "${HERE}/" "${REMOTE}:${DEPLOY_DIR}/"

# Ship the actual .env separately so its 0600 perms are preserved.
echo "→ uploading .env (0600 on remote)"
scp -q "${ENV_FILE}" "${REMOTE}:${DEPLOY_DIR}/.env"
ssh "${REMOTE}" "chmod 600 ${DEPLOY_DIR}/.env"

# ── 3. pull images + restart ─────────────────────────────────────
echo "→ pulling latest images on remote"
ssh "${REMOTE}" "cd ${DEPLOY_DIR} && docker compose -f docker-compose.prod.yml --env-file .env pull"

echo "→ starting/restarting services"
ssh "${REMOTE}" "cd ${DEPLOY_DIR} && docker compose -f docker-compose.prod.yml --env-file .env up -d --remove-orphans"

# ── 4. wait for healthz ──────────────────────────────────────────
echo "→ waiting for http://${REMOTE_HOST}:${PUBLIC_PORT}/healthz to return 200"
deadline=$((SECONDS + 120))
while [ ${SECONDS} -lt ${deadline} ]; do
    if curl -fsS --max-time 3 "http://${REMOTE_HOST}:${PUBLIC_PORT}/healthz" >/dev/null 2>&1; then
        echo ""
        echo "─────────────────────────────────────────────────────────"
        echo "✓ deploy ok"
        echo ""
        echo "  Open in browser:"
        echo "    http://${REMOTE_HOST}:${PUBLIC_PORT}"
        echo ""
        echo "  Login (initial demo super admin from .env):"
        echo "    account:  $(grep -E '^SUPER_ADMIN_ACCOUNT=' "${ENV_FILE}" | cut -d= -f2 || echo admin)"
        echo "    password: (in your .env: SUPER_ADMIN_PASSWORD)"
        echo ""
        echo "  Inspect:  ssh ${REMOTE} 'cd ${DEPLOY_DIR} && docker compose ps'"
        echo "  Logs:     ssh ${REMOTE} 'cd ${DEPLOY_DIR} && docker compose logs -f gateway'"
        echo "─────────────────────────────────────────────────────────"
        exit 0
    fi
    sleep 3
done

echo "" >&2
echo "✗ /healthz didn't return 200 within 120s." >&2
echo "  Debug on the remote: ssh ${REMOTE}" >&2
echo "    cd ${DEPLOY_DIR}" >&2
echo "    docker compose -f docker-compose.prod.yml ps" >&2
echo "    docker compose -f docker-compose.prod.yml logs --tail=80" >&2
exit 1
