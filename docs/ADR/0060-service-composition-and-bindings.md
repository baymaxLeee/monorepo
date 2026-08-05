# ADR 0060: Service composition and bindings

**Date**: 2026-08-05  
**Status**: Accepted  
**Supersedes**: Eve-style filesystem discovery / generated Procfile approach (rolled back)

## Context

This repo runs a multi-runtime product (Go / Python / Node) on local Docker,
Single-VPS, and Kubernetes. Prior work mixed three different models:

- next-forge-style monorepo packages (valid for frontend capability split)
- Vercel Services-style deployable units + routing + bindings (valid for
  product composition)
- Eve-style filesystem discovery and generated manifests (invalid as a
  general service registry)

We need one platform-neutral answer for: what is a deployable unit, what is
public vs internal, how services bind to each other, and how local / VPS /
K8s stay consistent — without auto-generating Procfile / justfile / K8s.

### Current inventory (2026-08-05)

| id | runtime | port | public via gateway | databases | bindings (outbound) |
|---|---|---|---|---|---|
| gateway | go | 8000 | `/*` (edge) | none (Redis DB1 ops) | iam, admin, chat, knowledge, telemetry |
| iam | go | 8002 | `/api/iam-server/*` | `iam` | — |
| admin | python | 8001 | `/api/admin-server/*` | `admin` | — |
| chat | node | 8009 | `/api/chat-server/*` | `chat` | admin, knowledge, executor |
| knowledge | python | 8010 | `/api/knowledge-server/*` | `knowledge` | admin |
| telemetry | python | 8008 | `/api/telemetry-server/*` | `telemetry` | — |
| executor | node | 8011 | none (internal-only) | `executor` (+ `workflow`) | admin, knowledge |

Cross-service edges today use HTTP + `X-Internal-Token` / `X-Caller-Service`
(and gateway JWT → `X-Auth-*` for public traffic). Gateway refuses proxying
downstream `/internal/*`.

## Decision

1. **Deployable unit** = one directory under `apps/backend/services/<id>` or
   `apps/frontend/apps/<id>` with its own build/runtime. Apps must not import
   other apps; services must not import other services' source.

2. **gateway is the only public HTTP edge** for backend APIs. It is a
   reverse-proxy BFF (auth, CORS, rate limit, trace), not a business
   aggregator. Frontend host (`platform`) is the only user-facing web entry.

3. **executor is internal-only**. It must not gain a public gateway route
   unless a future ADR explicitly opens one.

4. **Service-to-service calls use explicit bindings**, not directory
   inference. Callers use transport clients / configured base URLs; internal
   binding never replaces app-level auth or tenant isolation.

5. **Canonical declaration**: root `services.yaml` lists backend services
   with `runtime`, `port`, `publicRoutes`, `bindings`, `databases`, and optional
   `openapi`. Frontend apps stay out of this file (ports remain in
   `apps/frontend/justfile`).

6. **Phase-1 tooling only**: schema validation + drift checks against service
   directories, backend justfile, `Procfile.dev`, gateway routes, local env
   examples, Kubernetes, and Single-VPS configuration. **No generators** for
   Procfile, justfile, K8s, Orval, or docs.

7. **Independent deploy with product-level compatibility**. Vercel-style
   atomic multi-service deploy is not assumed on Kubernetes; adjacent
   versions must tolerate the bindings listed in `services.yaml`.

8. **Eve / discover-services stays rejected** for registry and manifest
   generation. Eve remains relevant only to agent runtime research.

## Consequences

**Pros**

- One explicit service graph for humans and machines
- Internal-only services cannot be “accidentally public” without editing
  `publicRoutes` and gateway config
- Frontend package work stays independent of backend composition

**Cons / follow-ups**

- `services.yaml` must be updated when ports, bindings, or publicity change
- Drift check fails until local and deployment composition surfaces stay aligned
- IAM OpenAPI is not declared because the service has no generated artifact; do not
  invent Go OpenAPI in this ADR (separate decision)

## Alternatives considered

- **Per-service `service.yaml`**: rejected for dual sources of truth
- **Filesystem discovery**: rejected (Eve rollback); ports in `.env.example`
  alone do not encode publicity or bindings
- **Generate all ops files from manifest**: deferred until measured cost
  savings exist (plan Phase 2 / 4.4)

## Implementation notes

- Validator: `scripts/check-services.py`
- Wire into root `just lint` as a non-generating check
- The former `.agents/service-catalog.yaml` had no runtime callers and was
  deleted; retaining it would create a second source of truth.
