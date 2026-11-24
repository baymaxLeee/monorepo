# prod overlay

Production deployment of the full backend stack. **Do not** `kubectl apply -k` this without first completing the checklist below.

## Pre-deploy checklist

1. **Replace placeholders**:
   - `REPLACE_ME_REGISTRY/monorepo/*` in `kustomization.yaml` → real 火山引擎 CR endpoint (e.g. `cr-cn-beijing.volces.com/<your-namespace>`)
   - `your-domain.com` in `patches/iam-config.yaml`, `patches/gateway-config.yaml`, `patches/ingress-host.yaml` → registered domain
2. **Create the namespace + Secrets out-of-band** (NEVER commit real secrets). The prod overlay **strips all Secret resources** from the applied manifest so placeholder `stringData` cannot overwrite live cluster secrets on deploy:
   ```bash
   kubectl create ns monorepo-prod
   ADMIN_TOKEN=$(openssl rand -hex 32)
   CHAT_TOKEN=$(openssl rand -hex 32)
   RUNTIME_TOKEN=$(openssl rand -hex 32)
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
     --from-literal=INTERNAL_SERVICE_TOKENS="{\"runtime\":\"$RUNTIME_TOKEN\"}"
   kubectl -n monorepo-prod create secret generic runtime-server-secrets \
     --from-literal=POSTGRES_HOST=<pg-host> \
     --from-literal=POSTGRES_USER=runtime \
     --from-literal=POSTGRES_PASSWORD=<from-1Password> \
     --from-literal=INTERNAL_API_TOKEN="$RUNTIME_TOKEN" \
     --from-literal=INTERNAL_SERVICE_TOKENS="{\"chat\":\"$CHAT_TOKEN\"}"
   ```
   Add or migrate the following keys in the same out-of-band Secret manager.
   The JSON receiver maps are exact; all references to one caller must use that
   caller's single token value:

   | Secret | Required service-identity data |
   |---|---|
   | `admin-secrets` | `INTERNAL_API_TOKEN=$ADMIN_TOKEN`; `INTERNAL_SERVICE_TOKENS={"canvas":"$CANVAS_TOKEN","chat":"$CHAT_TOKEN","knowledge":"$KNOWLEDGE_TOKEN"}` |
   | `canvas-secrets` | `INTERNAL_API_TOKEN=$CANVAS_TOKEN`; `INTERNAL_SERVICE_TOKENS={"runtime":"$RUNTIME_TOKEN"}` |
   | `chat-secrets` | `INTERNAL_API_TOKEN=$CHAT_TOKEN` |
   | `knowledge-secrets` | `INTERNAL_API_TOKEN=$KNOWLEDGE_TOKEN`; `INTERNAL_SERVICE_TOKENS={"runtime":"$RUNTIME_TOKEN"}` |
   | `runtime-server-secrets` | `INTERNAL_API_TOKEN=$RUNTIME_TOKEN`; `INTERNAL_SERVICE_TOKENS={"chat":"$CHAT_TOKEN"}` |
   | `runtime-worker-secrets` | `INTERNAL_API_TOKEN=$RUNTIME_TOKEN`; `INTERNAL_SERVICE_TOKENS={"runtime":"$RUNTIME_TOKEN"}` |
   | `runtime-sandbox-secrets` | `INTERNAL_SERVICE_TOKENS={"runtime":"$RUNTIME_TOKEN"}` |
   | `storage-secrets` | `INTERNAL_SERVICE_TOKENS={"admin":"$ADMIN_TOKEN","canvas":"$CANVAS_TOKEN","knowledge":"$KNOWLEDGE_TOKEN","runtime":"$RUNTIME_TOKEN"}` |

   Keep every Secret's existing database, signing, Redis and application keys;
   this is an in-place credential migration, not a Secret replacement. Each
   caller token must be non-empty and distinct from the other callers. Before
   deploying, run the same no-value-output preflight used by CI:

   ```bash
   kubectl -n monorepo-prod get secret \
     admin-secrets canvas-secrets chat-secrets knowledge-secrets \
     runtime-server-secrets runtime-worker-secrets runtime-sandbox-secrets storage-secrets \
     -o json | python3 scripts/check-k8s-service-identities.py
   ```

   The production deploy runs this check before migrations and rollouts, so a
   cluster with old or mismatched identity keys fails closed while existing
   workloads remain untouched. `chat-secrets` also includes
   `TOOL_APPROVAL_SECRET`; only the worker receives Runtime/Workflow DB
   credentials.
   For real ops, switch to ExternalSecrets Operator pointing at 火山引擎 KMS or Vault, or use sealed-secrets. Before deploying, provision one same-named PostgreSQL database/owner role for `iam`, `admin`, `canvas`, `chat`, `runtime`, `knowledge`, `storage`, and `telemetry`; reserve the `workflow` role/database for Workflow World. Enable `vector` only in `knowledge`.
3. **Set up TLS**: create the `api-tls` Secret either via cert-manager (Let's Encrypt issuer) or upload a Cloudflare Origin CA cert manually:
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

Storage uses `storage` Deployment/Service and `storage-secrets`, with the `storage`
PostgreSQL database/role and the `storage-data` PVC. Provision `storage-secrets`
with `POSTGRES_USER=storage` and the signing key under `STORAGE_SIGNING_KEY`.
Deployment tooling does not discover, rename or adopt legacy Storage identities;
the database, role and PVC must already use their current names. The migration Job
uses the Storage schema files against the `storage` database.

GitHub Actions deploy job:

1. Build & push image with tag = `${GITHUB_SHA::8}` to 火山 CR
2. Validate the live out-of-band service-identity keys and token relationships without printing token values.
3. Run the checked-in `db-init` migration image as a one-shot Job; the deploy stops before IAM bootstrap and rollout if any service migration fails. Run the Workflow World schema setup with its official CLI before Runtime worker rollout.
4. Pin the application images, including `storage`, in the prod overlay.
5. Apply release ConfigMaps, then run the IAM identity bootstrap and Admin built-in plugin release Jobs and wait for both to complete. Workspace admins manage plugin installations.
6. Render/apply the prod overlay; placeholder Secrets are removed by the overlay.
7. Wait for every application Deployment rollout, including `storage`.

## Rollback

```bash
kubectl rollout undo deployment/gateway -n monorepo-prod
kubectl rollout undo deployment/iam     -n monorepo-prod
# ... etc
```

Application rollback keeps the newer schema only after compatibility has been verified. Keep the migration Job image that recognizes the installed schema; there is no automatic DOWN execution. Use a reviewed forward repair or a verified restore for incompatible data changes. See [database migrations](../../../../docs/开发规范/database-migrations.md).

## Sandbox 执行环境

Runtime sandbox role 需要预配置 gVisor 与隔离出口；K8s 另需独立执行 namespace、Cilium 与节点 PID 上限。部署、配额和验证命令见 [Sandbox 运行规范](../../../../docs/微服务/sandbox.md)。缺失 runtime/网络策略时不会回退为宿主机执行。
