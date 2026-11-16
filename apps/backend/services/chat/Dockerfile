FROM node:24.18.0-slim
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ARG COREPACK_NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=${NPM_CONFIG_REGISTRY}
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json ./package.json
COPY apps/backend/package.json apps/backend/pnpm-workspace.yaml apps/backend/pnpm-lock.yaml ./apps/backend/
COPY apps/backend/libs/kernel-ts/package.json ./apps/backend/libs/kernel-ts/package.json
COPY apps/backend/services/runtime/package.json ./apps/backend/services/runtime/package.json
WORKDIR /app/apps/backend
RUN pnpm install --filter runtime... --prod --frozen-lockfile --config.node-linker=hoisted \
    --config.registry=${NPM_CONFIG_REGISTRY}
COPY apps/backend/libs/kernel-ts ./libs/kernel-ts
COPY apps/backend/services/runtime/tsconfig.json ./services/runtime/
COPY apps/backend/services/runtime/src ./services/runtime/src
WORKDIR /app/apps/backend/services/runtime
EXPOSE 8015
CMD ["node", "--import", "tsx", "src/index.ts"]
