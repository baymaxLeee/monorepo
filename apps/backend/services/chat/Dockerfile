FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json ./package.json
COPY apps/backend/package.json apps/backend/pnpm-workspace.yaml apps/backend/pnpm-lock.yaml ./apps/backend/
COPY apps/backend/libs/kernel-ts/package.json ./apps/backend/libs/kernel-ts/package.json
COPY apps/backend/libs/transport-ts/package.json ./apps/backend/libs/transport-ts/package.json
COPY apps/backend/services/chat/package.json ./apps/backend/services/chat/package.json
WORKDIR /app/apps/backend
# @backend/transport-ts is a source-only workspace dep; it pulls openapi-fetch
# at runtime. Install chat plus that workspace dep with a hoisted layout so
# openapi-fetch sits at the top level where the source import resolves it.
RUN pnpm install --filter chat... --prod --frozen-lockfile --config.node-linker=hoisted
COPY apps/backend/libs/kernel-ts ./libs/kernel-ts
COPY apps/backend/libs/transport-ts ./libs/transport-ts
COPY apps/backend/services/chat/tsconfig.json ./services/chat/
COPY apps/backend/services/chat/src ./services/chat/src
WORKDIR /app/apps/backend/services/chat
# Run the TypeScript source directly with tsx: @backend/transport-ts is a
# source-only workspace package (its entry is src/index.ts), so a tsc emit
# would leave an unresolvable bare import. tsx resolves the workspace dep at
# runtime, matching `pnpm dev`/`pnpm start`.
EXPOSE 8009
# Do not invoke pnpm at runtime: the image was installed with a hoisted
# node_modules layout, while pnpm's default runtime config is isolated. A
# `pnpm start` dependency check would therefore try to reinstall production
# dependencies against a layout it doesn't expect.
CMD ["node", "--import", "tsx", "src/index.ts"]
