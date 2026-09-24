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
   secrets). The prod overlay **strips all Secret resources** from the
   applied manifest so placeholder `stringData` cannot overwrite live
   cluster secrets on deploy:
   ```bash
   kubectl create ns monorepo-prod
   CHAT_TOKEN=$(openssl rand -hex 32)
   EXECUTOR_TOKEN=$(openssl rand -hex 32)
   KNOWLEDGE_TOKEN=$(openssl rand -hex 32)
   CANVAS_TOKEN=$(openssl rand -hex 32)
   kubectl -n monorepo-prod create secret generic postgres-admin-secrets \
     --from-literal=POSTGRES_HOST=<pg-host> \
     --from-literal=POSTGRES_ADMIN_USER=<migration-admin-user> \
     --from-literal=POSTGRES_ADMIN_PASSWORD=<migration-admin-password>
   kubectl -n monorepo-prod create secret generic gateway-secrets \
     --from-literal=REDIS_HOST=<redis-host> \
     --from-literal=ACCESS_TOKEN_SECRET=<256-bit-random>
   # gateway is Redis-only; DB-backed services also need Postgres creds, e.g.:
   kubectl -n monorepo-prod create secret generic iam-secrets \
     --from-literal=POSTGRES_HOST=<pg-host> \
     --from-literal=POSTGRES_USER=<svc-user> \
     --from-literal=POSTGRES_PASSWORD=<from-1Password> \
     --from-literal=ACCESS_TOKEN_SECRET=<256-bit-random>
   kubectl -n monorepo-prod create secret generic canvas-secrets \
     --from-literal=POSTGRES_HOST=<pg-host> \
     --from-literal=POSTGRES_USER=canvas \
     --from-literal=POSTGRES_PASSWORD=<from-1Password> \
     --from-literal=REDIS_URL=<redis-connection-uri> \
     --from-literal=INTERNAL_API_TOKEN="$CANVAS_TOKEN" \
     --from-literal=INTERNAL_SERVICE_TOKENS="{\"chat\":\"$CHAT_TOKEN\",\"executor\":\"$EXECUTOR_TOKEN\"}"
   # Create admin/knowledge/executor receiver maps from the same four caller
   # variables. Each workload's own INTERNAL_API_TOKEN must be unique; never
   # reuse one shared value. chat-secrets also includes TOOL_APPROVAL_SECRET.
   ```
   For real ops, switch to ExternalSecrets Operator pointing at
   火山引擎 KMS or Vault, or use sealed-secrets.
   Before deploying, provision one same-named PostgreSQL database/owner role
   for `iam`, `admin`, `canvas`, `chat`, `executor`, `knowledge`, and `telemetry`; reserve
   the `workflow` role/database for Workflow World. Enable `vector` only in
   `knowledge`.
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
2. Run the checked-in `db-init` migration image as a one-shot Job; the deploy
   stops before IAM bootstrap and rollout if any service migration fails. Run
   the Workflow World schema setup with its official CLI before executor rollout.
3. Pin all nine images (`gateway`, `iam`, `admin`, `canvas`, `chat`, `executor`,
   `knowledge`, `telemetry`, `web`) in the prod overlay.
4. Run the idempotent IAM identity bootstrap Job and wait for completion.
5. Render/apply the prod overlay; placeholder Secrets are removed by the overlay.
6. Wait for all nine Deployment rollouts.

## Rollback

```bash
kubectl rollout undo deployment/gateway -n monorepo-prod
kubectl rollout undo deployment/iam     -n monorepo-prod
# ... etc
```

For schema changes, rollback also requires running the previous migration's
DOWN script — kept simple by only making backward-compatible schema changes
during the demo phase.
