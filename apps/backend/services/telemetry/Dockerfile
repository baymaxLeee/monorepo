FROM --platform=$BUILDPLATFORM golang:1.27.4-alpine AS builder
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY . .
WORKDIR /src/services/telemetry
RUN --mount=type=cache,id=go-mod-v2,target=/go/pkg/mod go mod download
RUN --mount=type=cache,id=go-mod-v2,target=/go/pkg/mod \
    --mount=type=cache,id=go-build-v2,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -o /out/telemetry-server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/telemetry-server /telemetry-server
EXPOSE 8008
ENTRYPOINT ["/telemetry-server"]
