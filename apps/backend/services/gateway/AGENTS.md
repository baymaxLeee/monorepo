# gateway

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
- External REST API shape is `/api/<service-name>/*`, for example:
  - `/api/iam-server/login`
  - `/api/admin-server/bot`
- Gateway routes by service prefix only. It strips `/api/<service-name>` and
  forwards the remaining path to the upstream service. Do NOT enumerate every
  business endpoint in gateway.
- Use `slog` for structured logging
- Preserve `X-Trace-Id` and W3C `traceparent` propagation at the edge.
- RUM ingestion uses optional auth: `/api/telemetry-server/rum/*` allows
  anonymous writes, but propagates `X-Auth-*` when a valid access token is
  present. Do not add this path to public prefixes.
- All downstream calls have timeout + retry via `internal/clients/`
- Errors map to RFC 7807 problem-details JSON
