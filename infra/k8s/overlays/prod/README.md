# prod overlay

Production deployment of the full backend stack. **Do not** `kubectl apply -k`
this without first completing the checklist below.

## Pre-deploy checklist

1. **Replace placeholders**:
   - `REPLACE_ME_REGISTRY/monorepo/*` in `kustomization.yaml` →
     real 火山引擎 CR endpoint
     (e.g. `cr-cn-beijing.volces.com/<your-namespace>`)
   - `your-domain.com` in `patches/iam-config.yaml`,
     `patches/gateway-config.yaml`, `patches/ingress-host.yaml`
     → registered domain
2. **Create the namespace + Secrets out-of-band** (NEVER commit real
   secrets):
   ```bash
   kubectl create ns monorepo-prod
   kubectl -n monorepo-prod create secret generic gateway-secrets \
     --from-literal=MYSQL_HOST=<rds-host> \
     --from-literal=MYSQL_USER=<svc-user> \
     --from-literal=MYSQL_PASSWORD=<from-1Password> \
     --from-literal=REDIS_HOST=<redis-host> \
     --from-literal=ACCESS_TOKEN_SECRET=<256-bit-random>
   # repeat for iam-secrets, admin-secrets, telemetry-secrets
   ```
   For real ops, switch to ExternalSecrets Operator pointing at
   火山引擎 KMS or Vault, or use sealed-secrets.
3. **Set up TLS**: create the `api-tls` Secret either via cert-manager
   (Let's Encrypt issuer) or upload a Cloudflare Origin CA cert manually:
   ```bash
   kubectl -n monorepo-prod create secret tls api-tls \
     --cert=origin.pem --key=origin.key
   ```
4. **Apply once** to verify dry-run:
   ```bash
   kubectl kustomize infra/k8s/overlays/prod | less
   kubectl apply -k infra/k8s/overlays/prod --dry-run=server
   ```

## CI flow

GitHub Actions deploy job:

1. Build & push image with tag = `${GITHUB_SHA::8}` to 火山 CR
2. `cd infra/k8s/overlays/prod && kustomize edit set image gateway=<new-image>:<sha>`
   (and the other 3 services)
3. Apply db-migrate Job; wait for completion
4. `kubectl apply -k infra/k8s/overlays/prod`
5. `kubectl rollout status deployment/<each> -n monorepo-prod --timeout=5m`

## Rollback

```bash
kubectl rollout undo deployment/gateway -n monorepo-prod
kubectl rollout undo deployment/iam     -n monorepo-prod
# ... etc
```

For schema changes, rollback also requires running the previous migration's
DOWN script — kept simple by only making backward-compatible schema changes
during the demo phase.
