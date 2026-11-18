#!/bin/bash
set -euo pipefail
# Keep the policy outside the guest-mounted socket directory.
policy=/run/sandbox-egress-policy.conf
case "${SANDBOX_EGRESS_MODE-allowlist}" in
  disabled) echo 'http_access deny all' > "$policy" ;;
  public) echo 'http_access allow !private' > "$policy" ;;
  allowlist)
    cp /etc/squid/allowed-domains.txt /run/sandbox-allowed-domains.txt
    domains=${SANDBOX_EGRESS_EXTRA_DOMAINS:-}
    label='[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?'
    if [[ -n "$domains" ]]; then
      if [[ ! "$domains" =~ ^[.]?$label([.]$label)*(,[.]?$label([.]$label)*)*$ ]]; then
        echo "Invalid SANDBOX_EGRESS_EXTRA_DOMAINS: expected comma-separated DNS names" >&2
        exit 1
      fi
      tr ',' '\n' <<< "$domains" >> /run/sandbox-allowed-domains.txt
    fi
    printf '%s\n' 'acl allowed dstdomain -n "/run/sandbox-allowed-domains.txt"' 'http_access allow allowed !private' > "$policy"
    ;;
  *) echo "Invalid SANDBOX_EGRESS_MODE: expected disabled, allowlist or public" >&2; exit 1 ;;
esac
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
