FROM golang:1.23-alpine AS builder
WORKDIR /src
COPY apps/backend/services/api-gateway/go.mod apps/backend/services/api-gateway/go.sum* ./
RUN go mod download
COPY apps/backend/services/api-gateway/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/server /server
EXPOSE 8000
ENTRYPOINT ["/server"]
