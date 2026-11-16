FROM node:24.18.0-slim
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ARG COREPACK_NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=${NPM_CONFIG_REGISTRY}
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json ./package.json
COPY pnpm-workspace.yaml pnpm-lock.yaml .pnpmfile.mjs ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/backend/libs/kernel-ts/package.json ./apps/backend/libs/kernel-ts/package.json
COPY apps/backend/services/chat/package.json ./apps/backend/services/chat/package.json
RUN pnpm install --filter @backend/chat... --prod --frozen-lockfile --config.node-linker=hoisted \
    --config.registry=${NPM_CONFIG_REGISTRY}
COPY apps/backend/libs/kernel-ts ./apps/backend/libs/kernel-ts
COPY apps/backend/services/chat/tsconfig.json ./apps/backend/services/chat/
COPY apps/backend/services/chat/src ./apps/backend/services/chat/src
WORKDIR /app/apps/backend/services/chat
EXPOSE 8009
CMD ["node", "--import", "tsx", "src/index.ts"]
