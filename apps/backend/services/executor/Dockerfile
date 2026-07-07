FROM node:22-slim AS build
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json ./package.json
COPY apps/backend/package.json apps/backend/pnpm-workspace.yaml apps/backend/pnpm-lock.yaml ./apps/backend/
COPY apps/backend/libs/kernel-ts/package.json ./apps/backend/libs/kernel-ts/package.json
COPY apps/backend/libs/transport-ts/package.json ./apps/backend/libs/transport-ts/package.json
COPY apps/backend/services/executor/package.json ./apps/backend/services/executor/package.json
WORKDIR /app/apps/backend
# Full install (incl. devDeps: nitro/rollup are needed to build).
RUN pnpm install --filter executor... --frozen-lockfile
COPY apps/backend/libs/kernel-ts ./libs/kernel-ts
COPY apps/backend/libs/transport-ts ./libs/transport-ts
COPY apps/backend/services/executor ./services/executor
WORKDIR /app/apps/backend/services/executor
RUN pnpm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg is required by the video-generation workflow to normalize + concat
# per-scene clips into one reel. OS binary (not ffmpeg-static) to avoid Nitro/nft
# native-binary bundling issues; FFMPEG_PATH defaults to `ffmpeg` on PATH.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/apps/backend/services/executor/.output ./.output
# WORKFLOW_TARGET_WORLD is loaded through createRequire() rooted at /app,
# while Nitro writes traced dependencies under .output/server/node_modules.
# Expose that self-contained dependency tree at Node's root lookup location.
RUN ln -s .output/server/node_modules node_modules
EXPOSE 8011
CMD ["node", ".output/server/index.mjs"]
