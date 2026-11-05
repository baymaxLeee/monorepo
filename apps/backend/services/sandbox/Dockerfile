FROM docker:29-cli AS docker
FROM registry.k8s.io/kubectl:v1.35.0 AS kubectl
FROM node:24.18.0-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=kubectl /bin/kubectl /usr/local/bin/kubectl
COPY package.json ./package.json
COPY apps/backend/package.json apps/backend/pnpm-workspace.yaml apps/backend/pnpm-lock.yaml ./apps/backend/
COPY apps/backend/libs/kernel-ts/package.json ./apps/backend/libs/kernel-ts/package.json
COPY apps/backend/services/sandbox/package.json ./apps/backend/services/sandbox/package.json
WORKDIR /app/apps/backend
RUN pnpm install --filter sandbox... --prod --frozen-lockfile --config.node-linker=hoisted
COPY apps/backend/libs/kernel-ts ./libs/kernel-ts
COPY apps/backend/services/sandbox/src ./services/sandbox/src
WORKDIR /app/apps/backend/services/sandbox
EXPOSE 8014
CMD ["node", "--import", "tsx", "src/index.ts"]
