# api-gateway

Go-based BFF / API gateway. Sits between frontend and backend Python services.

## Responsibilities
- Route external HTTP requests to internal services
- Handle authentication (JWT verification, token refresh)
- Cross-cutting concerns: rate limiting, request logging, tracing
- Aggregation: combine multiple internal calls into BFF responses

## Does NOT do
- Business logic (delegate to domain services)
- Persist its own state (stateless)

## Layout
- `cmd/server/main.go` — entry point
- `internal/handlers/` — route handlers
- `internal/middleware/` — auth, logging, tracing
- `internal/clients/` — typed clients for downstream services

## Conventions
- Use `chi` router (already standard)
- Use `slog` for structured logging
- All downstream calls have timeout + retry via `internal/clients/`
- Errors map to RFC 7807 problem-details JSON

## Test
- `go test ./...`
