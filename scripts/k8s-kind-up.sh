#!/usr/bin/env bash
# Spin up a local kind (Kubernetes IN Docker) cluster and deploy the prod
# overlay against it. Use this to validate the K8s manifest design without
# spending money on a real cloud cluster.
#
# What it does:
#   1. Creates kind cluster `monorepo` (idempotent)
#   2. Installs Nginx Ingress Controller
#   3. Creates `monorepo-prod` namespace + placeholder Secrets
#   4. Loads locally-built images into the cluster (if present)
#   5. Renders prod overlay and applies it (dry-run by default; pass --apply
#      to actually apply)
#
# Usage:
#   scripts/k8s-kind-up.sh                # dry-run only
#   scripts/k8s-kind-up.sh --apply        # actually create resources
#   scripts/k8s-kind-up.sh --apply --build # also build & load images first
#
# Teardown: scripts/k8s-kind-down.sh

set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-monorepo}"
NAMESPACE="${KIND_NAMESPACE:-monorepo-prod}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

APPLY=false
BUILD=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --build) BUILD=true ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ── 1. dependencies ───────────────────────────────────────
need() {
  command -v "$1" >/dev/null 2>&1 || { echo "✗ missing: $1" >&2; exit 1; }
}
need docker
need kind
need kubectl
# `kustomize` standalone is optional — `kubectl kustomize` (used below) works
# without it. We still warn so users can `brew install kustomize` if they want
# the dedicated CLI for `kustomize edit` / `kustomize build` flows elsewhere.
if ! command -v kustomize >/dev/null 2>&1; then
  echo "ℹ  kustomize CLI not found — falling back to 'kubectl kustomize'" >&2
fi

if ! docker info >/dev/null 2>&1; then
  echo "✗ docker is installed but not running. Start Docker Desktop / colima first." >&2
  exit 1
fi

# ── 2. cluster ────────────────────────────────────────────
if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  echo "→ kind cluster '${CLUSTER_NAME}' already exists"
else
  echo "→ creating kind cluster '${CLUSTER_NAME}'..."
  # Map 80/443 from the kind node to the host so Ingress is reachable
  # at http://localhost / https://localhost without port-forward.
  cat <<EOF | kind create cluster --name "${CLUSTER_NAME}" --config -
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - { containerPort: 80,   hostPort: 8080, protocol: TCP }
      - { containerPort: 443,  hostPort: 8443, protocol: TCP }
EOF
fi

kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null
kubectl cluster-info --context "kind-${CLUSTER_NAME}" | head -3

# ── 3. Nginx Ingress Controller ───────────────────────────
if ! kubectl get ns ingress-nginx >/dev/null 2>&1; then
  echo "→ installing Nginx Ingress Controller..."
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
fi

echo "→ waiting for ingress controller to become ready..."
# Use rollout status — it waits for the Deployment to exist AND become
# available, sidestepping `kubectl wait`'s "no matching resources found"
# race when pods haven't been scheduled yet.
kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=180s

# ── 4. namespace + placeholder secrets ────────────────────
kubectl get ns "${NAMESPACE}" >/dev/null 2>&1 || kubectl create ns "${NAMESPACE}"

create_secret_if_missing() {
  local name="$1"; shift
  if kubectl -n "${NAMESPACE}" get secret "${name}" >/dev/null 2>&1; then
    echo "  ✓ secret/${name} already exists"
    return
  fi
  echo "  + creating placeholder secret/${name}"
  kubectl -n "${NAMESPACE}" create secret generic "${name}" "$@"
}

# Placeholders use values that satisfy the prod fail-fast validators but are
# only meaningful inside this local cluster. NEVER copy these to the cloud.
create_secret_if_missing gateway-secrets \
  --from-literal=MYSQL_HOST=mysql.kind.local \
  --from-literal=MYSQL_USER=gateway \
  --from-literal=MYSQL_PASSWORD=kind-only-not-a-real-password \
  --from-literal=REDIS_HOST=redis.kind.local \
  --from-literal=ACCESS_TOKEN_SECRET="$(openssl rand -hex 32 2>/dev/null || echo deadbeef-deadbeef-deadbeef-deadbeef-deadbeef-deadbeef-deadbeef-deadbeef)"

create_secret_if_missing iam-secrets \
  --from-literal=MYSQL_HOST=mysql.kind.local \
  --from-literal=MYSQL_USER=iam \
  --from-literal=MYSQL_PASSWORD=kind-only-not-a-real-password \
  --from-literal=ACCESS_TOKEN_SECRET="$(openssl rand -hex 32 2>/dev/null || echo deadbeef-deadbeef-deadbeef-deadbeef-deadbeef-deadbeef-deadbeef-deadbeef)"

create_secret_if_missing admin-secrets \
  --from-literal=MYSQL_HOST=mysql.kind.local \
  --from-literal=MYSQL_USER=admin \
  --from-literal=MYSQL_PASSWORD=kind-only-not-a-real-password \
  --from-literal=REDIS_HOST=redis.kind.local

create_secret_if_missing telemetry-secrets \
  --from-literal=MYSQL_HOST=mysql.kind.local \
  --from-literal=MYSQL_USER=telemetry \
  --from-literal=MYSQL_PASSWORD=kind-only-not-a-real-password

# Self-signed TLS so Ingress accepts HTTPS termination (not actually trusted).
if ! kubectl -n "${NAMESPACE}" get secret api-tls >/dev/null 2>&1; then
  TMPDIR=$(mktemp -d)
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMPDIR/key.pem" \
    -out "$TMPDIR/cert.pem" -subj "/CN=api.local.test" -days 30 \
    -addext "subjectAltName=DNS:api.local.test,DNS:localhost" 2>/dev/null
  kubectl -n "${NAMESPACE}" create secret tls api-tls \
    --cert="$TMPDIR/cert.pem" --key="$TMPDIR/key.pem"
  rm -rf "$TMPDIR"
fi

# ── 5. optional: build & load images ──────────────────────
if $BUILD; then
  echo "→ building service images..."
  for svc in gateway iam; do
    docker build -t "monorepo/${svc}:local" -f "${ROOT}/apps/backend/services/${svc}/Dockerfile" "${ROOT}/apps/backend/services/${svc}"
  done
  for svc in admin telemetry; do
    docker build -t "monorepo/${svc}:local" -f "${ROOT}/apps/backend/services/${svc}/Dockerfile" "${ROOT}/apps/backend"
  done
  echo "→ loading images into kind cluster..."
  for svc in gateway iam admin telemetry; do
    kind load docker-image "monorepo/${svc}:local" --name "${CLUSTER_NAME}"
  done
fi

# ── 6. render + apply ─────────────────────────────────────
RENDER_DIR=$(mktemp -d)
trap 'rm -rf "$RENDER_DIR"' EXIT

cp -r "${ROOT}/infra" "${RENDER_DIR}/infra"
K8S_DIR="${RENDER_DIR}/infra/k8s"

# Rewrite image references so kind can resolve them.
# If --build was used, point at the locally-loaded images; otherwise leave
# the placeholders (manifest validates but pods will ImagePullBackOff —
# expected in dry-run / schema-validation mode).
if $BUILD; then
  if ! command -v kustomize >/dev/null 2>&1; then
    echo "✗ --build requires the standalone 'kustomize' CLI for image overrides" >&2
    echo "  install: brew install kustomize" >&2
    exit 1
  fi
  pushd "${K8S_DIR}/overlays/prod" >/dev/null
  for svc in gateway iam admin telemetry; do
    kustomize edit set image \
      "ghcr.io/example/${svc}=monorepo/${svc}:local"
  done
  popd >/dev/null
fi

# Patch the Ingress host to api.local.test so we can hit it via
# https://localhost:8443 with a Host header override.
cat > "${K8S_DIR}/overlays/prod/patches/ingress-host.yaml" <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api
spec:
  tls:
    - hosts: [api.local.test]
      secretName: api-tls
  rules:
    - host: api.local.test
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: gateway
                port: { number: 8000 }
EOF

OUT_FILE="${RENDER_DIR}/rendered.yaml"
# --load-restrictor=LoadRestrictionsNone lets overlays reference raw files
# one level up (e.g. ../../base/ingress.yaml).
kubectl kustomize --load-restrictor=LoadRestrictionsNone \
  "${K8S_DIR}/overlays/prod" > "${OUT_FILE}"

echo ""
echo "→ rendered manifest: $(wc -l < "${OUT_FILE}") lines, $(grep -c '^kind:' "${OUT_FILE}") resources"

if $APPLY; then
  echo "→ applying to kind cluster..."
  kubectl apply -f "${OUT_FILE}"
  echo ""
  echo "─────────────────────────────────────────────────────────────"
  echo "✓ Prod overlay deployed to local kind cluster."
  echo ""
  echo "  Pods:"
  kubectl -n "${NAMESPACE}" get pods 2>/dev/null | sed 's/^/    /' || true
  echo ""
  echo "  Hit the API via:"
  echo "    curl -k --resolve api.local.test:8443:127.0.0.1 https://api.local.test:8443/livez"
  echo ""
  echo "  Inspect: kubectl -n ${NAMESPACE} get all"
  echo "  Logs:    kubectl -n ${NAMESPACE} logs -l app=gateway -f"
  echo "  Teardown: scripts/k8s-kind-down.sh"
  echo "─────────────────────────────────────────────────────────────"
else
  echo "→ running server-side dry-run apply..."
  kubectl apply -f "${OUT_FILE}" --dry-run=server
  echo ""
  echo "✓ Manifest passed kube-apiserver schema validation."
  echo "  To actually deploy:  $0 --apply"
  echo "  To build + deploy:   $0 --apply --build"
fi
