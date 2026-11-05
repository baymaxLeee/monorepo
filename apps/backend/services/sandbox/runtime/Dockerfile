FROM node:24-bookworm-slim AS node
FROM python:3.14-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash curl ca-certificates jq git ripgrep file unzip zip poppler-utils ffmpeg socat \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 sandbox && useradd --uid 1000 --gid 1000 --no-create-home sandbox
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY apps/backend/services/sandbox/runtime/runner.py /opt/sandbox/runner.py
RUN chmod 0555 /opt/sandbox/runner.py
WORKDIR /workspace
ENTRYPOINT ["python3", "-I", "/opt/sandbox/runner.py"]
