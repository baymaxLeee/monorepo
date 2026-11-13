FROM debian:bookworm-slim
ARG DEBIAN_MIRROR=deb.debian.org
RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends squid socat tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY apps/backend/services/sandbox/proxy/squid.conf /etc/squid/squid.conf
COPY apps/backend/services/sandbox/proxy/allowed-domains.txt /etc/squid/allowed-domains.txt
COPY apps/backend/services/sandbox/proxy/start.sh /usr/local/bin/start-proxy
RUN chmod 0555 /usr/local/bin/start-proxy
EXPOSE 3128
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/start-proxy"]
