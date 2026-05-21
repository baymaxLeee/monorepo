#!/usr/bin/env bash
# Deprecated entrypoint — use `just install` from repo root.
set -euo pipefail
echo "→ bootstrap.sh is now `just install`"
exec "$(dirname "$0")/install-deps.sh"
