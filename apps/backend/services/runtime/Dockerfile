FROM docker:29-cli AS docker
FROM registry.k8s.io/kubectl:v1.35.0 AS kubectl

FROM node:24.18.0-slim AS build
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ARG COREPACK_NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=${NPM_CONFIG_REGISTRY}
WORKDIR /app
RUN corepack enable
COPY package.json ./package.json
COPY apps/backend/package.json apps/backend/pnpm-workspace.yaml apps/backend/pnpm-lock.yaml ./apps/backend/
COPY apps/backend/libs/agent-runtime-ts/package.json ./apps/backend/libs/agent-runtime-ts/package.json
COPY apps/backend/libs/kernel-ts/package.json ./apps/backend/libs/kernel-ts/package.json
COPY apps/backend/libs/transport-ts/package.json ./apps/backend/libs/transport-ts/package.json
COPY apps/backend/services/runtime/package.json ./apps/backend/services/runtime/package.json
WORKDIR /app/apps/backend
RUN pnpm install --filter runtime... --frozen-lockfile --config.registry=${NPM_CONFIG_REGISTRY}
COPY apps/backend/libs/agent-runtime-ts ./libs/agent-runtime-ts
COPY apps/backend/libs/kernel-ts ./libs/kernel-ts
COPY apps/backend/libs/transport-ts ./libs/transport-ts
COPY apps/backend/services/runtime ./services/runtime
WORKDIR /app/apps/backend/services/runtime
RUN pnpm run build

FROM node:24.18.0-slim
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ARG COREPACK_NPM_REGISTRY=https://registry.npmjs.org
ARG DEBIAN_MIRROR=deb.debian.org
ENV npm_config_registry=${NPM_CONFIG_REGISTRY}
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable \
  && sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=kubectl /bin/kubectl /usr/local/bin/kubectl
COPY package.json ./package.json
COPY apps/backend/package.json apps/backend/pnpm-workspace.yaml apps/backend/pnpm-lock.yaml ./apps/backend/
COPY apps/backend/libs/agent-runtime-ts/package.json ./apps/backend/libs/agent-runtime-ts/package.json
COPY apps/backend/libs/kernel-ts/package.json ./apps/backend/libs/kernel-ts/package.json
COPY apps/backend/libs/transport-ts/package.json ./apps/backend/libs/transport-ts/package.json
COPY apps/backend/services/runtime/package.json ./apps/backend/services/runtime/package.json
WORKDIR /app/apps/backend
RUN pnpm install --filter runtime... --prod --frozen-lockfile --config.node-linker=hoisted \
    --config.registry=${NPM_CONFIG_REGISTRY}
COPY apps/backend/libs/agent-runtime-ts ./libs/agent-runtime-ts
COPY apps/backend/libs/kernel-ts ./libs/kernel-ts
COPY apps/backend/libs/transport-ts ./libs/transport-ts
COPY apps/backend/services/runtime/src ./services/runtime/src
COPY apps/backend/services/runtime/sandbox-assets ./services/runtime/sandbox-assets
COPY --from=build /app/apps/backend/services/runtime/.output ./services/runtime/.output
WORKDIR /app/apps/backend/services/runtime
# Workflow resolves its configured World from /app. Point that lookup at the
# traced dependency tree shipped inside the worker build.
RUN ln -s apps/backend/services/runtime/.output/server/node_modules /app/node_modules
EXPOSE 8011 8014 8015
CMD ["node", "--import", "tsx", "src/cmd/server/main.ts"]
