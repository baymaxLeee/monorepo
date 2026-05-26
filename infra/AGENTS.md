# infra/

Deployment artifacts for all services and MFEs.

## Layout
- `docker/`              — shared Dockerfiles (Dockerfiles also live in `apps/<…>/Dockerfile`)
- `k8s/base/<svc>/`      — Kustomize base: `deployment.yaml`, `service.yaml`,
                           `configmap.yaml`, `secret.yaml` (placeholder),
                           `kustomization.yaml`
- `k8s/base/db-migrate/` — schema migration Job template (one-shot per deploy)
- `k8s/base/ingress.yaml` — public HTTP entry point (overlays patch host)
- `k8s/overlays/{dev,prod}` — environment-specific patches

## Conventions
- Every service ConfigMap has `ENVIRONMENT` (development/staging/production).
  Service code validates production-required fields at startup; misconfiguration
  fails fast.
- Sensitive values (`*_PASSWORD`, `ACCESS_TOKEN_SECRET`, `*_HOST` for managed
  databases) live in `Secret` resources, never in ConfigMap. Real values are
  injected out-of-band (CI / `kubectl create secret` / ExternalSecrets), not
  committed to git.
- Liveness probe hits `/livez` (process only); readiness probe hits `/readyz`
  (dependency-aware). Never tie liveness to MySQL/Redis health.
- Every Deployment sets resource requests + limits, topologySpreadConstraints
  across hostnames, and a 30s graceful shutdown window.

## Adding a new service deployment
1. Create `k8s/base/<svc>/{deployment,service,configmap,secret,kustomization}.yaml`
2. Add to `k8s/overlays/<env>/kustomization.yaml` under `resources:`
3. Add an `images:` mapping in each overlay so CI can pin `newTag` per deploy
4. Wire CI: `.github/workflows/deploy-<svc>.yml` (or extend the shared one)

## Rules
- NEVER hardcode credentials in YAML — `Secret` placeholders only.
- Resource limits MUST be set on every Deployment container.
- Probes MUST distinguish `/livez` from `/readyz`.
- Each service eventually has its own ServiceAccount (least-priv) —
  currently using `default`, follow-up to harden.
