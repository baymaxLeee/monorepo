#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-monorepo}"

if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  kind delete cluster --name "${CLUSTER_NAME}"
  echo "✓ kind cluster '${CLUSTER_NAME}' deleted"
else
  echo "(no kind cluster '${CLUSTER_NAME}' found)"
fi
