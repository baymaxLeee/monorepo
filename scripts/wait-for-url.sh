#!/usr/bin/env bash
# wait-for-url.sh — block until a URL returns 2xx, then exit 0.
#
# Usage: ./scripts/wait-for-url.sh <url> [label] [timeout-seconds]
#   <url>             URL to poll (HEAD/GET, follows redirects, considers any 2xx success)
#   [label]           pretty name printed in logs (default: "service")
#   [timeout-seconds] give up after this many seconds (default: 120)
#
# Why: services started in parallel by overmind/Procfile have implicit runtime
# deps (e.g. platform needs admin's mf-manifest.json). This polls until the
# upstream is ready before continuing the dependent process command.

set -euo pipefail

URL="${1:?usage: wait-for-url.sh <url> [label] [timeout-seconds]}"
LABEL="${2:-service}"
TIMEOUT="${3:-120}"

start=$(date +%s)
echo "[wait-for] ${LABEL}: waiting for ${URL} (timeout ${TIMEOUT}s)..."

while true; do
    if curl -fsSL --max-time 2 "${URL}" >/dev/null 2>&1; then
        elapsed=$(( $(date +%s) - start ))
        echo "[wait-for] ${LABEL}: ready after ${elapsed}s"
        exit 0
    fi

    elapsed=$(( $(date +%s) - start ))
    if [ "${elapsed}" -ge "${TIMEOUT}" ]; then
        echo "[wait-for] ${LABEL}: TIMEOUT after ${TIMEOUT}s waiting for ${URL}" >&2
        exit 1
    fi

    sleep 0.5
done
