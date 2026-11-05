FROM golang:1.26.3-alpine AS builder
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/server ./cmd/server
RUN mkdir -p /out/assets && chmod 0750 /out/assets

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/server /server
# Docker initializes an empty named volume from this non-root-owned directory.
COPY --from=builder --chown=65532:65532 /out/assets /data/assets
EXPOSE 8013
ENTRYPOINT ["/server"]
