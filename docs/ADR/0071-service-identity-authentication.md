# ADR 0071: Per-caller service identity authentication

**Date**: 2026-09-23  
**Status**: Accepted  
**Related**: ADR-0060, ADR-0061

## Context

Internal HTTP endpoints currently authenticate every service with one shared
`INTERNAL_API_TOKEN` and then trust the caller-supplied `X-Caller-Service`
header. Any service that learns the shared token can therefore impersonate any
other service. This is especially unsafe for Admin endpoints that return
decrypted model-provider credentials to selected callers. Gateway also attaches
the shared token to ordinary user-facing proxy requests even though those
requests are authenticated with propagated user identity.

The canonical binding graph in `services.yaml` has four internal API receivers
and four workload callers:

| Receiver | Allowed callers | Sensitive capability |
|---|---|---|
| `admin` | `chat`, `executor`, `knowledge`, `canvas` | providers, skills, agents, managed configuration |
| `knowledge` | `chat`, `executor`, `canvas` | documents, artifacts, service objects |
| `executor` | `chat`, `canvas`, `knowledge` | durable task creation, status, cancellation |
| `canvas` | `chat`, `executor` | project and generation workflow operations |

Gateway is not an internal caller. It exposes the public routes declared in
`services.yaml`, propagates authenticated user context, and rejects downstream
`/internal/*` paths.

## Decision

1. Each workload has one independent opaque service credential.
   `INTERNAL_API_TOKEN` means the credential of the running caller, never a
   cluster-wide shared secret.
2. Every internal API receiver is configured with an explicit JSON object in
   `INTERNAL_SERVICE_TOKENS`, mapping allowed caller IDs to their expected
   credentials. A request is authenticated only when both
   `X-Caller-Service` and `X-Internal-Token` match the same map entry using a
   constant-time comparison. Unknown callers are rejected.
3. The two headers remain the transport contract. This is an intentional
   breaking semantic change: there is no fallback to the former shared token.
4. Gateway no longer attaches internal-auth headers to proxied public traffic.
5. Route-level authorization remains mandatory. Authentication proves the
   workload identity; it does not grant every authenticated caller every
   capability. Sensitive routes continue to restrict their allowed callers.
6. Secrets are injected by the deployment environment. They are never placed
   in `services.yaml`, generated OpenAPI, URLs, logs, or traces.
7. Implementations remain service-local across Go, Python, and TypeScript. The
   shared artifact is this protocol contract, not a cross-language auth kernel.

## Security properties and limits

- Compromise of one workload credential cannot be used to impersonate a
  different caller. Receivers can revoke or rotate one identity independently.
- TLS and network policy remain required to protect bearer credentials in
  transit and reduce reachability. This protocol is application authentication,
  not a substitute for transport security.
- Replay protection is intentionally delegated to TLS and short network paths.
  If the platform later provides workload identity (for example SPIFFE/mTLS),
  it should replace opaque credentials rather than add a second compatibility
  layer.

## Alternatives considered

- **Keep one token and validate caller names**: rejected because possession of
  the token still permits caller impersonation.
- **One shared HMAC signing key**: rejected for the same impersonation problem.
- **A new cross-language auth library**: rejected; it creates a high-risk
  mega-kernel without reducing the small local verification surface.
- **Immediate service mesh or SPIFFE rollout**: sound long-term direction, but
  disproportionate to the current deployment environments. Per-caller opaque
  credentials remove the current privilege-escalation flaw without coupling the
  application to one orchestrator.

## Migration and verification

This repository has no compatibility obligation. All senders, receivers, local
composition, Single-VPS, and Kubernetes configuration migrate in one change;
the old shared-token validation path is deleted. Validate every edge in the
consumer matrix, run scoped service checks, `scripts/check-services.py`, root
`just lint`, and the post-implementation review in ADR-0016.

For local development, each `.env.example` declares the workload token and,
for receivers, the complete accepted-caller map. `just install` only rewrites
the retired `dev-internal-token` placeholder and never overwrites an explicit
custom credential. `just dev-preflight` then rejects any caller/receiver drift
before the stack starts, so authentication failures cannot surface later as
unrelated upload or provider errors.
