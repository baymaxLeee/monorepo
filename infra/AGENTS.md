# infra/

Deployment artifacts for all services and MFEs.

## Layout
- `docker/`     — shared Dockerfiles (or kept in `apps/<…>/Dockerfile`)
- `k8s/base/`   — Kustomize base, one folder per deployable
- `k8s/overlays/{dev,staging,prod}` — environment-specific patches

## Adding a new service deployment
1. Create `k8s/base/<svc>/{deployment,service,configmap}.yaml`
2. Add to `k8s/overlays/<env>/kustomization.yaml`
3. Wire CI: `.github/workflows/deploy-<svc>.yml`

## Rules
- NEVER hardcode credentials in YAML — use `secretRef` to External Secrets
- Resource limits MUST be set on every Deployment
- Each service has its own ServiceAccount (least-priv)
