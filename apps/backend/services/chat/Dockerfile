FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json ./package.json
COPY apps/backend/package.json apps/backend/pnpm-workspace.yaml apps/backend/pnpm-lock.yaml ./apps/backend/
COPY apps/backend/libs/transport-ts/package.json ./apps/backend/libs/transport-ts/package.json
COPY apps/backend/services/chat/package.json ./apps/backend/services/chat/package.json
WORKDIR /app/apps/backend
# Hoisted layout puts openapi-fetch (transitive dep of the source-only
# @backend/transport-ts workspace pkg) at the top level so Nitro's bundler
# can resolve and inline it; pnpm's default isolated layout hides it and the
# dep ends up unresolvable at runtime.
RUN pnpm install --filter chat --frozen-lockfile --config.node-linker=hoisted
COPY apps/backend/libs/transport-ts ./libs/transport-ts
COPY apps/backend/services/chat/tsconfig.json apps/backend/services/chat/nitro.config.ts ./services/chat/
COPY apps/backend/services/chat/src ./services/chat/src
WORKDIR /app/apps/backend/services/chat
RUN pnpm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/backend/services/chat/.output ./.output
EXPOSE 8009
CMD ["node", ".output/server/index.mjs"]
