#!/bin/bash
set -euo pipefail
mkdir -p /run/egress
chmod 0755 /run/egress
rm -f /run/egress/proxy.sock
rm -f /tmp/squid-access.pipe /tmp/squid-cache.pipe
mkfifo -m 0666 /tmp/squid-access.pipe /tmp/squid-cache.pipe
cat /tmp/squid-access.pipe &
access_log=$!
cat /tmp/squid-cache.pipe >&2 &
cache_log=$!
# Only this proxy owns the socket directory; guests receive a read-only mount.
socat UNIX-LISTEN:/run/egress/proxy.sock,fork,mode=0666 TCP:127.0.0.1:3128 &
relay=$!
squid -N -f /etc/squid/squid.conf &
proxy=$!
trap 'kill "$relay" "$proxy" "$access_log" "$cache_log" 2>/dev/null || true; wait || true' EXIT TERM INT
wait -n "$relay" "$proxy"
