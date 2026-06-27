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
RUN pnpm exec ncc build node_modules/@workflow/world-postgres/bin/setup.js -o /app/workflow-setup --minify
# The official setup CLI resolves Drizzle SQL files relative to its compiled
# module. ncc bundles JavaScript only, so preserve the package's migration tree
# at the location resolved by the bundle.
RUN mkdir -p /app/src/drizzle && \
    cp -R node_modules/@workflow/world-postgres/src/drizzle/migrations /app/src/drizzle/migrations
COPY apps/backend/libs/transport-ts ./libs/transport-ts
COPY apps/backend/services/chat/tsconfig.json apps/backend/services/chat/nitro.config.ts ./services/chat/
COPY apps/backend/services/chat/src ./services/chat/src
WORKDIR /app/apps/backend/services/chat
RUN pnpm run build

FROM node:22-slim AS runtime-deps
WORKDIR /app
RUN corepack enable
COPY package.json ./package.json
COPY apps/backend/package.json apps/backend/pnpm-workspace.yaml apps/backend/pnpm-lock.yaml ./apps/backend/
COPY apps/backend/libs/transport-ts/package.json ./apps/backend/libs/transport-ts/package.json
COPY apps/backend/services/chat/package.json ./apps/backend/services/chat/package.json
WORKDIR /app/apps/backend
# Workflow loads the selected World by package name at runtime, so it cannot
# be statically discovered by Nitro. Keep a production-only dependency tree
# for that dynamic module boundary.
RUN pnpm install --filter chat --prod --frozen-lockfile --config.node-linker=hoisted

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/backend/services/chat/.output ./.output
COPY --from=builder /app/workflow-setup ./workflow-setup
COPY --from=builder /app/src ./src
COPY --from=runtime-deps /app/apps/backend/node_modules ./node_modules
EXPOSE 8009
CMD ["node", ".output/server/index.mjs"]
