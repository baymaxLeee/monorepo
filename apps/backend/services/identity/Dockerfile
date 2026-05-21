FROM golang:1.23-alpine AS builder
WORKDIR /src
COPY apps/backend/services/identity/go.mod apps/backend/services/identity/go.sum* ./
RUN go mod download
COPY apps/backend/services/identity/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/server /server
EXPOSE 8002
ENTRYPOINT ["/server"]
