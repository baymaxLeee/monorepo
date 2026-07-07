# ADR 0026: Unified structured logging with trace propagation

## Status

Accepted.

## Context

The backend is a Go + Python + Node mix, and logging had drifted per stack:

- **Go** (`gateway`, `iam`) used a default `slog` JSON handler: uppercase
  `LEVEL`, local-timezone nanosecond `time`, and no `service` field. `iam` had
  no request-logging or trace middleware at all.
- **Python** (`admin`, `knowledge`, `telemetry`) relied on stdlib `logging`
  plus uvicorn's default *text* access log, which does not interleave with any
  structured line format and carries no `trace_id`.
- **Node** (`chat`, `executor`) logged through `console.*` — unstructured,
  no `service`, no `trace_id`.

`X-Trace-Id` was generated only at the gateway edge and never threaded into
per-service logs, so a single request could not be correlated across services,
and no single query/aggregation rule could consume all lines.

Clean, correlated structured logs are also the prerequisite for any later
LLM/agent observability work.

## Decision

Define one cross-stack **wire contract** in
`schemas/observability/logging.md` (a peer of `openapi/` and `proto/`):

- stdout NDJSON; reserved fields `time` (RFC3339, millisecond, UTC, `Z`),
  `level` (lowercase `debug|info|warn|error`), `msg`, `service`; optional
  `trace_id` (32-hex, omitted when absent — never an empty string) and
  `span_id`. Business context is flattened as top-level `snake_case` keys.

Each language uses its **native structured logger — no OpenTelemetry SDK**:

- **Go** `log/slog` with a `ReplaceAttr` that lowercases `level` and rewrites
  `time` to millisecond UTC, plus `logger.With("service", ...)`.
- **Python** `structlog` rendering JSON, wired through `logging.config.dictConfig`
  so stdlib + `uvicorn`/`uvicorn.error`/`uvicorn.access` share the same
  renderer; uvicorn's own access log is disabled (`--no-access-log`) in favor
  of an ASGI `RequestLoggingMiddleware`.
- **Node** `pino` with `isoTime`, a lowercase level formatter, `base: { service }`,
  and a `mixin` that reads the correlation registry.

Field names follow OTel log semantics so a future OTel Collector can transform
them with no service-code change.

**Correlation-context propagation.** A request carries a small set of
low-cardinality correlation identifiers, defined once per stack in a
**propagation-field registry** (`{header, log_key, ctx_key}`):

| field | header | source |
| --- | --- | --- |
| `trace_id` | `X-Trace-Id` (W3C `traceparent` compatible) | gateway edge generates/normalizes |
| `user_id` | `X-Auth-User-ID` | gateway injects from the verified JWT |
| `workspace_id` | `X-Workspace-Id` | reserved (gateway injects when available) |
| `tenant_id` | `X-Tenant-Id` | reserved |

Every service's inbound middleware reads the registry into the language-native
request context (Go `context`, Python `contextvar`, Node `AsyncLocalStorage`);
the logger injects every present field automatically; outbound internal clients
forward them onto the downstream request. **Adding a field is one registry row** —
middleware, logger, and transport all iterate it. `libs/transport-ts` takes an
injected `propagatedHeaders` callback (built by `libs/kernel-ts` from the current
context) so it forwards the whole set without depending on the context impl.

**Logging context is not the full auth context.** The logging registry carries
low-cardinality correlation identifiers (`trace_id`, `user_id`, and reserved
workspace/tenant ids). Gateway still owns the broader auth header contract
(`X-Auth-Email`, `X-Auth-Name`, `X-Auth-Roles`, `X-Auth-Org-*`) used by admin,
knowledge, and telemetry authorization. Those headers may be forwarded for
business auth, but logger injection stays intentionally narrow.

**executor is a special case.** Workflow DevKit `"use workflow"`/`"use step"`
run in a replayable sandbox that does not preserve `AsyncLocalStorage` across
step boundaries and forbids static Node imports in the orchestrator. Executor's
HTTP layer uses pino + middleware, but workflow-imported clients do not import
`@backend/kernel-ts` or `@backend/kernel-ts/trace`, because even the trace
subpath depends on `node:async_hooks`. Cross-step payload-level trace propagation
is therefore the remaining follow-up before workflow-internal logs can be fully
correlated.

**Implementation homes.** Python: `libs/kernel`. Node: a new `libs/kernel-ts`
(logger + trace context + Hono middleware). Go: each service's
`internal/middleware` — `gateway` and `iam` carry their own copy of the
self-contained `TraceId`/`RequestLogger`/slog setup. A shared Go kernel module
was rejected: `go.work` has two independent service modules and each Dockerfile
builds from its own single-module context (`COPY . .`), so a shared module would
force a build-context / justfile / infra rewrite — disproportionate to ~200
lines of dependency-free middleware during the demo phase.

## Consequences

- One `trace_id` correlates every log line for a request across
  gateway → iam/admin/knowledge/chat/executor; `user_id` rides the same
  registry, so it both labels logs *and* forwards on service-to-service calls.
- Auth propagation remains owned by gateway and still carries the headers needed
  by the current org/role authorization model. Logging consumes only the
  low-cardinality registry fields, so structured logs do not accidentally turn
  the full auth/profile snapshot into query dimensions.
- Go `level` is lowercase, carries `service`, and uses UTC millisecond `time`;
  `RequestLogger` skips health-check paths to cut noise (matching the Node
  middleware's skip list).
- `chat` replaced all `console.*` with pino; `executor`'s HTTP entry uses pino,
  while workflow-internal `console.*` stays for now under the sandbox
  constraint above.
- No OpenTelemetry SDK and no centralized log-query service are introduced;
  attaching an OTel Collector later is a contract-table transform, not a
  code change.
- `gateway` and `iam` duplicate ~200 lines of middleware. Accepted trade-off:
  zero build-system churn and no cross-service import (respecting the service
  boundary rule); revisit if a third Go service appears.

## References

- `schemas/observability/logging.md` — the wire contract this ADR ratifies.
- Native loggers: Go `log/slog`, Python `structlog`, Node `pino`.
- W3C Trace Context (`traceparent`) and the OTel Logs Data Model (field mapping,
  reference only). W3C Baggage was considered for identity propagation but
  rejected: discrete `X-*` headers keep the existing trace/auth headers, make the
  gateway's allow-list sanitisation trivial, and stay readable — the field set is
  single-digit, and a Collector can still map them onto Baggage later.
- ADR 0001 (monorepo structure), ADR 0004 (chat TS / knowledge Py split).
