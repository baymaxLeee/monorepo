FROM --platform=$BUILDPLATFORM golang:1.26.3-alpine AS builder
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum* ./
RUN --mount=type=cache,id=go-mod-v2,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,id=go-mod-v2,target=/go/pkg/mod \
    --mount=type=cache,id=go-build-v2,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/canvas-server ./cmd/server && \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/canvas-worker ./cmd/worker

FROM debian:bookworm-slim
ARG DEBIAN_MIRROR=deb.debian.org
RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
USER 65532:65532
COPY --from=builder /out/canvas-server /canvas-server
COPY --from=builder /out/canvas-worker /canvas-worker
EXPOSE 8012
ENTRYPOINT ["/canvas-server"]
