#!/usr/bin/env bash
set -euo pipefail

if command -v overmind >/dev/null 2>&1; then
  echo "→ Starting via overmind (Procfile.dev)"
  exec overmind start -f Procfile.dev
fi

if command -v mprocs >/dev/null 2>&1; then
  echo "→ Starting via mprocs"
  exec mprocs --config Procfile.dev
fi

if command -v hivemind >/dev/null 2>&1; then
  echo "→ Starting via hivemind"
  exec hivemind Procfile.dev
fi

echo "No process manager found. Falling back to shell mode."
echo "  Tip: brew install overmind"
exec "$(dirname "$0")/dev-stack.sh"
