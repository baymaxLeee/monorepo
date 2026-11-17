FROM --platform=$BUILDPLATFORM golang:1.27.4-alpine AS builder
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY . .
WORKDIR /src/services/storage
RUN --mount=type=cache,id=go-mod-v2,target=/go/pkg/mod go mod download
RUN --mount=type=cache,id=go-mod-v2,target=/go/pkg/mod \
    --mount=type=cache,id=go-build-v2,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -o /out/server ./cmd/server
RUN mkdir -p /out/assets && chmod 0750 /out/assets

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/server /server
# Docker initializes an empty named volume from this non-root-owned directory.
COPY --from=builder --chown=65532:65532 /out/assets /data/assets
EXPOSE 8013 9013
ENTRYPOINT ["/server"]
