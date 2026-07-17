# gateway

Go-based BFF / API gateway. Sits between frontend and backend Python services.

## Responsibilities
- Route external HTTP requests to internal services (prefix reverse proxy)
- Handle authentication (JWT verification, identity header propagation)
- Cross-cutting concerns: rate limiting, request logging, tracing

## Does NOT do
- Business logic (delegate to domain services)
- Persist its own state (stateless)
- BFF aggregation / typed downstream clients (not implemented; gateway is a
  pure streaming reverse proxy today — there is no populated
  `internal/infrastructure/clients/`)

## Layout
- `cmd/server/main.go` — entry point + middleware chain
- `internal/bootstrap/config/` — process configuration
- `internal/api/http/handlers/` — reverse proxy + health handlers
- `internal/api/http/middleware/` — trace id, logging, recover, body limit, CORS,
  identity propagation, rate limit (`rate_limit.go`, `go-chi/httprate`)
- `internal/infrastructure/` — Redis store, security, observability, and clients

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
- Downstream requests are proxied via `httputil.ReverseProxy` with deadlines
  cleared for SSE/streaming. Gateway does NOT retry proxied/streaming requests
  (replaying a consumed/streamed body is unsafe); downstream retry belongs in the
  calling service's transport client, limited to idempotent, non-streaming,
  connection-level failures.
- Edge rate limiting via `go-chi/httprate` (keyed per user, IP fallback; over
  limit → 429 problem+json + `Retry-After`; health probes exempt). In-memory /
  single-instance; move the counter to Redis for multi-replica.
- Errors map to RFC 7807 problem-details JSON
