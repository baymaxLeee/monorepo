#!/usr/bin/env bash
# Run this ONCE on a fresh VPS (Debian / Ubuntu / RHEL-derived).
#
# What it does:
#   1. Installs Docker + Docker Compose plugin
#   2. Creates /opt/monorepo  (deploy target)
#   3. Opens firewall for the public port (if ufw / firewalld present)
#   4. Sets up a `monorepo-update` systemd path-trigger? — no, kept simple
#
# Usage (on the VPS):
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/infra/single-vps/bootstrap.sh | sudo bash
# Or:
#   sudo bash infra/single-vps/bootstrap.sh
#
# Idempotent: re-running is a no-op when everything is already installed.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "✗ run me as root (sudo bash $0)" >&2
    exit 1
fi

DEPLOY_DIR="${DEPLOY_DIR:-/opt/monorepo}"
PUBLIC_PORT="${PUBLIC_PORT:-8080}"

echo "→ bootstrapping single-VPS deployment to ${DEPLOY_DIR} (port ${PUBLIC_PORT})"

# ── 1. install Docker ─────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
    echo "→ installing Docker (via get.docker.com)"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
else
    echo "  ✓ docker already installed: $(docker --version)"
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "✗ docker compose plugin missing; install manually:" >&2
    echo "    apt-get install docker-compose-plugin" >&2
    exit 1
else
    echo "  ✓ docker compose plugin available: $(docker compose version)"
fi

# ── 2. create deploy directory ────────────────────────────────────
mkdir -p "${DEPLOY_DIR}"
chmod 750 "${DEPLOY_DIR}"
echo "  ✓ ${DEPLOY_DIR} ready"

# ── 3. open firewall for the public port ──────────────────────────
# Cloud providers (Aliyun / 火山 / Tencent) ALSO require opening this port
# in the web console's "安全组 / Security Group" — this script can only
# manage the OS-level firewall.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    echo "→ opening port ${PUBLIC_PORT} in ufw"
    ufw allow "${PUBLIC_PORT}/tcp" comment "monorepo-web" || true
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    echo "→ opening port ${PUBLIC_PORT} in firewalld"
    firewall-cmd --permanent --add-port="${PUBLIC_PORT}/tcp" || true
    firewall-cmd --reload || true
else
    echo "  (no active ufw / firewalld; nothing to open at OS layer)"
fi

# ── 4. sanity check ───────────────────────────────────────────────
echo ""
echo "✓ bootstrap complete."
echo ""
echo "Next steps (on your laptop, NOT here):"
echo "  1. Edit infra/single-vps/.env.example → save as infra/single-vps/.env"
echo "  2. Run: ./infra/single-vps/deploy.sh <user>@<this-vps-ip>"
echo ""
echo "Then in your cloud console (Aliyun / 火山引擎 etc.):"
echo "  • Open port ${PUBLIC_PORT}/tcp in the Security Group"
echo "  • That's mandatory — OS firewall is not enough"
