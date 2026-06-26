FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY libs/transport-ts/package.json ./libs/transport-ts/package.json
COPY services/chat/package.json ./services/chat/package.json
RUN pnpm install --filter chat --frozen-lockfile
COPY libs/transport-ts ./libs/transport-ts
COPY services/chat/tsconfig.json services/chat/nitro.config.ts ./services/chat/
COPY services/chat/src ./services/chat/src
WORKDIR /app/services/chat
RUN pnpm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/services/chat/.output ./.output
EXPOSE 8009
CMD ["node", ".output/server/index.mjs"]
