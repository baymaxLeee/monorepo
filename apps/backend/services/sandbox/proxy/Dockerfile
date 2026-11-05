FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends squid socat tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY apps/backend/services/sandbox/proxy/squid.conf /etc/squid/squid.conf
COPY apps/backend/services/sandbox/proxy/allowed-domains.txt /etc/squid/allowed-domains.txt
COPY apps/backend/services/sandbox/proxy/start.sh /usr/local/bin/start-proxy
RUN chmod 0555 /usr/local/bin/start-proxy
EXPOSE 3128
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/start-proxy"]
