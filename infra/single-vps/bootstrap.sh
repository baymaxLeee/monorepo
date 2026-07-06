#!/usr/bin/env bash
# Run this ONCE on a fresh VPS (Debian / Ubuntu / RHEL-derived).
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

mkdir -p "${DEPLOY_DIR}"
chmod 750 "${DEPLOY_DIR}"
echo "  ✓ ${DEPLOY_DIR} ready"

# --- sops + age: needed to decrypt operator secrets on this box (ADR 0031) ---
# China-hosted VPS note: GitHub release CDN is often blocked/slow. We therefore
# prefer distro packages, cap every GitHub download with a timeout, and honor an
# optional GH_PROXY (e.g. GH_PROXY=https://mirror.ghproxy.com/) so downloads can
# be routed through a mirror instead of hanging forever.
ARCH="$(uname -m)"
case "${ARCH}" in
    x86_64|amd64) GOARCH=amd64 ;;
    aarch64|arm64) GOARCH=arm64 ;;
    *) echo "✗ unsupported arch ${ARCH} for sops/age auto-install" >&2; exit 1 ;;
esac
AGE_VER=v1.2.1
SOPS_VER=v3.9.4
GH_PROXY="${GH_PROXY:-}"
gh_dl() { url="$1"; shift; curl -fsSL --connect-timeout 20 --retry 2 --retry-delay 2 "$@" "${GH_PROXY}${url}"; }

if command -v age-keygen >/dev/null 2>&1; then
    echo "  ✓ age already installed: $(age --version 2>/dev/null || echo present)"
else
    echo "→ installing age"
    if command -v apt-get >/dev/null 2>&1 && \
       { apt-get install -y age >/dev/null 2>&1 || \
         { apt-get update -qq >/dev/null 2>&1 && apt-get install -y age >/dev/null 2>&1; }; } && \
       command -v age-keygen >/dev/null 2>&1; then
        echo "  ✓ age via apt"
    else
        echo "  apt unavailable; downloading age ${AGE_VER} from GitHub${GH_PROXY:+ via proxy}"
        tmp="$(mktemp -d)"
        gh_dl "https://github.com/FiloSottile/age/releases/download/${AGE_VER}/age-${AGE_VER}-linux-${GOARCH}.tar.gz" \
            | tar -xz -C "${tmp}"
        install -m 0755 "${tmp}/age/age" "${tmp}/age/age-keygen" /usr/local/bin/
        rm -rf "${tmp}"
        echo "  ✓ age installed to /usr/local/bin"
    fi
fi

if command -v sops >/dev/null 2>&1; then
    echo "  ✓ sops already installed: $(sops --version 2>/dev/null | head -1)"
else
    echo "→ installing sops ${SOPS_VER} from GitHub${GH_PROXY:+ via proxy}"
    if gh_dl "https://github.com/getsops/sops/releases/download/${SOPS_VER}/sops-${SOPS_VER}.linux.${GOARCH}" \
         -o /usr/local/bin/sops; then
        chmod 0755 /usr/local/bin/sops
        echo "  ✓ sops installed to /usr/local/bin"
    else
        echo "✗ failed to download sops from GitHub." >&2
        echo "  Re-run with a mirror, e.g.:" >&2
        echo "    sudo env GH_PROXY=https://mirror.ghproxy.com/ bash /tmp/bootstrap.sh" >&2
        exit 1
    fi
fi

# Age keypair: private key stays ONLY on this box; public key goes into
# .sops.yaml so the encrypted secrets.sops.env can be decrypted here.
AGE_KEY_FILE="${DEPLOY_DIR}/age.key"
if [ ! -f "${AGE_KEY_FILE}" ]; then
    echo "→ generating age key at ${AGE_KEY_FILE}"
    age-keygen -o "${AGE_KEY_FILE}" >/dev/null 2>&1
    chmod 600 "${AGE_KEY_FILE}"
else
    echo "  ✓ age key already present at ${AGE_KEY_FILE}"
fi
AGE_PUBKEY="$(age-keygen -y "${AGE_KEY_FILE}")"

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

echo ""
echo "✓ bootstrap complete."
echo ""
echo "─────────────────────────────────────────────────────────"
echo "This VPS's age PUBLIC key (safe to share/commit):"
echo ""
echo "    ${AGE_PUBKEY}"
echo ""
echo "─────────────────────────────────────────────────────────"
echo ""
echo "Next steps (on your laptop, NOT here):"
echo "  1. Put the age public key above into .sops.yaml (repo root)."
echo "  2. Create the encrypted operator secrets from the template:"
echo "       cp infra/single-vps/secrets.sops.env.example /tmp/s.env"
echo "       \$EDITOR /tmp/s.env    # fill in super-admin + Tavily + crypto keys"
echo "       sops --encrypt --input-type dotenv --output-type dotenv /tmp/s.env \\"
echo "         > infra/single-vps/secrets.sops.env"
echo "       shred -u /tmp/s.env"
echo "     Then commit infra/single-vps/secrets.sops.env (it is encrypted)."
echo "  3. Deploy:"
echo "       IMAGE_REGISTRY=ghcr.io/<owner>/<repo> \\"
echo "         ./infra/single-vps/deploy.sh <user>@<this-vps-ip>"
echo ""
echo "Then in your cloud console (Aliyun / 火山引擎 etc.):"
echo "  • Open port ${PUBLIC_PORT}/tcp in the Security Group"
echo "  • That's mandatory — OS firewall is not enough"
