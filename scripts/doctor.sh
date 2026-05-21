#!/usr/bin/env bash
# Quick health check for required tools.
set -u

ok() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
miss() { printf "  \033[31m✗\033[0m %s\n" "$1"; }

check() {
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1 ($($1 --version 2>&1 | head -1))"
  else
    miss "$1 NOT FOUND"
    return 1
  fi
}

echo "── Tooling check ──"
fail=0
for cmd in node pnpm python uv go just docker jq curl mise; do
  check "$cmd" || fail=1
done

echo ""
echo "── Docker services ──"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q monorepo-mysql; then
  ok "mysql running"
else
  miss "mysql NOT running (try: just up)"
fi
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q monorepo-redis; then
  ok "redis running"
else
  miss "redis NOT running (try: just up)"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "All required tools present. Try: just install && just dev"
else
  echo "Some tools missing. Install via: mise install (or follow https://mise.jdx.dev)"
  exit 1
fi
