#!/usr/bin/env bash
# Deploy / update the single-VPS stack from a local checkout.
#
# Secrets model (docs/ADR/0031): the VPS assembles its own compose `.env`, so
# this script ships NO plaintext secrets. It only:
#   - passes IMAGE_REGISTRY / IMAGE_TAG / PUBLIC_PORT through the environment
#   - rsyncs the ops files (compose + render-env.sh + the SOPS-encrypted
#     secrets.sops.env) to the VPS
#   - runs render-env.sh on the VPS (generates internal secrets, decrypts the
#     operator secrets with the VPS-local age key) then `docker compose up`
#
# Usage:
#   IMAGE_REGISTRY=ghcr.io/<owner>/<repo> ./infra/single-vps/deploy.sh <user>@<host>
#   IMAGE_REGISTRY=ghcr.io/acme/monorepo  ./infra/single-vps/deploy.sh root@1.2.3.4
#
# Prereqs:
#   - VPS bootstrapped (bootstrap.sh: installs docker + sops/age + age key)
#   - infra/single-vps/secrets.sops.env exists and is committed (see .example)
#   - SSH key auth to the VPS
#   - images for IMAGE_TAG built and pushed
#
# Env:
#   IMAGE_REGISTRY  (required)     registry path images were pushed to
#   IMAGE_TAG       (default main) which tag to deploy
#   PUBLIC_PORT     (default 8080) host port nginx binds
#   DEPLOY_DIR      (default /opt/monorepo) remote path

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: IMAGE_REGISTRY=... $0 <user>@<host>" >&2
    echo "Example: IMAGE_REGISTRY=ghcr.io/acme/monorepo $0 root@1.2.3.4" >&2
    exit 1
fi

REMOTE="$1"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/monorepo}"
HERE="$(cd "$(dirname "$0")" && pwd)"
IMAGE_REGISTRY="${IMAGE_REGISTRY:?set IMAGE_REGISTRY, e.g. ghcr.io/owner/repo}"
IMAGE_TAG="${IMAGE_TAG:-main}"
PUBLIC_PORT="${PUBLIC_PORT:-8080}"
REMOTE_HOST="${REMOTE#*@}"

if [ ! -f "${HERE}/secrets.sops.env" ]; then
    echo "✗ ${HERE}/secrets.sops.env missing." >&2
    echo "  Create it once with sops (see secrets.sops.env.example), then commit it." >&2
    exit 1
fi

echo "→ syncing infra/single-vps → ${REMOTE}:${DEPLOY_DIR}"
ssh "${REMOTE}" "mkdir -p ${DEPLOY_DIR}"
ssh "${REMOTE}" "for f in otel-collector.yaml clickhouse-low-memory.xml clickhouse-users.xml; do [ ! -d \"${DEPLOY_DIR}/\$f\" ] || rm -rf \"${DEPLOY_DIR}/\$f\"; done"

# Ship only the small ops files. All service code (nginx.conf, postgres-init.sh)
# is baked into the images. The VPS-local age.key and generated .env.secrets are
# NOT in the source dir, so --exclude='*' protects them from --delete.
rsync -avz --delete \
    --include='docker-compose.prod.yml' \
    --include='render-env.sh' \
    --include='otel-collector.yaml' \
    --include='clickhouse-low-memory.xml' \
    --include='clickhouse-users.xml' \
    --include='secrets.sops.env' \
    --include='README.md' \
    --exclude='*' \
    "${HERE}/" "${REMOTE}:${DEPLOY_DIR}/"

echo "→ rendering .env on remote (generate internal secrets + decrypt operator secrets)"
ssh "${REMOTE}" "cd ${DEPLOY_DIR} && IMAGE_REGISTRY='${IMAGE_REGISTRY}' IMAGE_TAG='${IMAGE_TAG}' PUBLIC_PORT='${PUBLIC_PORT}' bash render-env.sh"

# Compose validates every required interpolation as the final source of truth.
echo "→ validating compose config on remote"
ssh "${REMOTE}" "cd ${DEPLOY_DIR} && docker compose -f docker-compose.prod.yml --env-file .env config --quiet"

echo "→ pulling latest images on remote"
ssh "${REMOTE}" "cd ${DEPLOY_DIR} && docker compose -f docker-compose.prod.yml --env-file .env pull"

echo "→ starting/restarting services"
ssh "${REMOTE}" "cd ${DEPLOY_DIR} && docker compose -f docker-compose.prod.yml --env-file .env up -d --remove-orphans"

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
        echo "  Login: super-admin account/password are in secrets.sops.env"
        echo "         (edit with: sops infra/single-vps/secrets.sops.env)"
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
