FROM --platform=$BUILDPLATFORM golang:1.27.4-alpine AS builder
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY . .
WORKDIR /src/services/iam
RUN --mount=type=cache,id=go-mod-v2,target=/go/pkg/mod go mod download
RUN --mount=type=cache,id=go-mod-v2,target=/go/pkg/mod \
    --mount=type=cache,id=go-build-v2,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/server ./cmd/server && \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/seed ./cmd/seed

FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/server /server
COPY --from=builder /out/seed /seed
EXPOSE 8002
ENTRYPOINT ["/server"]
