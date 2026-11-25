# Single-VPS Deployment

The VPS serves the Platform SPA and its remotes from nginx. The default browser
entry is `http://<vps-ip>:8080`; `PUBLIC_PORT` selects the published port.
Nginx forwards API traffic to Gateway. Chat reaches the internal Runtime server,
which uses the worker and sandbox roles for durable jobs and isolated execution.
Telemetry stores RUM in PostgreSQL and reads traces from ClickHouse via the
observability stack.

The [Compose manifest](docker-compose.prod.yml) owns service names, image tags,
ports and volumes. The [nginx configuration](nginx.conf) owns public routing.
The VPS pulls built images from the selected registry. For Kubernetes, use the
[production overlay guide](../k8s/overlays/prod/README.md).

## Files in this directory

| File                       | Purpose                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| `docker-compose.prod.yml`  | Full stack definition, including one-shot DB migration jobs                      |
| `nginx.conf`               | Web server config (baked into `web` image)                                       |
| `Dockerfile.web`           | Builds the nginx + frontend dist image                                           |
| `Dockerfile.db-init`       | Builds the one-shot schema migrator image                                        |
| `postgres-init.sh`         | Shell script run by `db-init` container (baked into image)                       |
| `secrets.sops.env.example` | Template for the operator secrets you hand-manage                                |
| `secrets.sops.env`         | SOPS-encrypted operator secrets (committed; you create it once)                  |
| `render-env.sh`            | Runs on the VPS: generates internal secrets + decrypts operator secrets → `.env` |
| `reset-application-data.sh` | Recreates non-core data while preserving Admin and IAM                           |
| `bootstrap.sh`             | Install Docker + sops/age + generate age key on a fresh VPS (run once, on VPS)   |
| `deploy.sh`                | Push config + restart containers (run from laptop / CI)                          |

### Secrets model

See the [operations decision](../../docs/ADR/operations.md).

The VPS assembles its own compose `.env` from three disjoint sources — you only hand-manage the middle-column "operator" secrets:

| Bucket | Who sets it | Where it lives |
| --- | --- | --- |
| `IMAGE_REGISTRY` / `IMAGE_TAG` / `PUBLIC_PORT` / `PUBLIC_GATEWAY_URL` | CI / `deploy.sh` | passed in the environment |
| Database passwords + per-service `*_INTERNAL_API_TOKEN` credentials + `TOOL_APPROVAL_SECRET` + `STORAGE_SIGNING_KEY` | **auto-generated on the VPS** | `.env.secrets` (0600, VPS-only, never in git) |
| super-admin login, `EXA_API_KEY` / `TAVILY_API_KEY`, `ACCESS_TOKEN_SECRET`, `ADMIN_SECRET_KEY` | **you** | `secrets.sops.env` (SOPS-encrypted, committed) |

---

## First-time setup (≤ 1 hour, mostly waiting)

### 0. Prerequisites

- A VPS with public IP. Recommended: 4C4G 3M, any cloud (Aliyun / Tencent / 火山引擎 / Vultr / Hetzner). Cost: ¥38–¥99/year.
- SSH key set up on the VPS (paste your `~/.ssh/id_*.pub` into `~/.ssh/authorized_keys` during cloud-console setup, OR use the cloud console's built-in key uploader).
- GitHub repo with the build-images workflow run at least once (so images exist in GHCR).

### 1. Bootstrap the VPS (run on the VPS, as root)

```bash
ssh root@<vps-ip>
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/infra/single-vps/bootstrap.sh | bash
```

This installs Docker + `sops` + `age`, opens the OS firewall for port 8080, and generates the VPS's age keypair. It prints the **age public key** at the end — copy it, you'll need it in step 3. Idempotent.

### 2. Open the port in the cloud security group

OS firewall ≠ cloud security group. Go to your cloud console:

- **Aliyun 轻量** → 防火墙 → 添加规则 → TCP 8080
- **腾讯云 Lighthouse** → 防火墙 → 添加规则 → TCP 8080
- **火山引擎 ECS** → 安全组 → 入方向 → TCP 8080
- **Vultr / Hetzner** → no security group by default; OS firewall is enough

### 3. Configure operator secrets (run on your laptop, ONE time)

You only manage a handful of secrets; database passwords etc. are generated on the VPS automatically. Install `sops` + `age` locally (`brew install sops age`), then:

```bash
cd /path/to/monorepo

# a) Generate an OFFLINE recovery key (keep recovery.key somewhere safe — a
#    password manager / offsite backup — NOT in this repo). Lets you rebuild a
#    lost VPS and still decrypt ADMIN_SECRET_KEY etc.:
age-keygen -o recovery.key            # prints its public key; back up recovery.key

# b) Put BOTH public keys into .sops.yaml — the VPS key (printed by bootstrap.sh)
#    and the recovery key from step (a):
$EDITOR .sops.yaml                    # replace the two age1REPLACE... placeholders

# c) Create the encrypted operator secrets from the template:
cp infra/single-vps/secrets.sops.env.example /tmp/s.env
$EDITOR /tmp/s.env        # fill in SUPER_ADMIN_PASSWORD, EXA_API_KEY, TAVILY_API_KEY, etc.
sops --encrypt --input-type dotenv --output-type dotenv /tmp/s.env \
  > infra/single-vps/secrets.sops.env
shred -u /tmp/s.env

# d) Commit it — it's encrypted, safe in git (recovery.key stays OUT of git):
git add .sops.yaml infra/single-vps/secrets.sops.env
git commit -m "chore(single-vps): operator secrets"
```

Edit later anytime with: `sops infra/single-vps/secrets.sops.env`.

> `IMAGE_REGISTRY` is not a secret — you pass it to `deploy.sh` (step 5) or CI derives it automatically.

### 4. Trigger CI to build the images (if not already)

```bash
git push origin main
# wait ~5 minutes — watch GitHub Actions → build-images go green
```

The registry contains one image per backend service declared in
[services.yaml](../../services.yaml), plus `web`, `db-init`, `sandbox-runtime`
and `sandbox-proxy`.

### 5. Deploy (run on your laptop)

```bash
IMAGE_REGISTRY=ghcr.io/<owner>/<repo> ./infra/single-vps/deploy.sh root@<vps-ip>
```

Output ends with the URL to open in a browser.

Database upgrades preserve existing data: `db-init` verifies applied SQL checksums and runs pending versions before services start. Do not set `RESET_DATA=true` for a schema upgrade. That option is an explicitly destructive whole-stack reinstall.

For a deliberate application-data reset that retains operator configuration and
identity state, deploy with `RESET_APPLICATION_DATA=true`. It preserves the
PostgreSQL `admin` and `iam` databases and their shared infrastructure, while it
recreates Storage, Canvas, Chat, Runtime/Workflow, Knowledge and Telemetry data.
It also removes all Redis cache/session state plus the Storage and ClickHouse
data volumes. Existing logins are invalidated, but provider and integration
configuration remains in the preserved `admin` database. The full
`RESET_DATA=true` mode and the selective mode are mutually exclusive.

Storage runs as `storage` with `STORAGE_*` configuration, the `storage`
PostgreSQL database/role and the `storage_data` byte volume mounted at `/data/assets`.
Deployment tooling has no legacy Storage identity compatibility; database, role,
volume and persisted secrets must already use their current names before deployment.

For an application rollback verified to accept the current schema, keep the migration image pinned to the release that owns that schema:

```bash
IMAGE_TAG=<compatible-previous-app-sha> DB_INIT_IMAGE_TAG=<current-schema-sha> \
IMAGE_REGISTRY=ghcr.io/<owner>/<repo> ./infra/single-vps/deploy.sh root@<vps-ip>
```

`DB_INIT_IMAGE_TAG` defaults to `IMAGE_TAG` on ordinary deployments. It separates business schema setup only; Workflow World version requirements remain independent. Upgrade verification, backups, recovery and data backfills follow the [database migration specification](../../docs/开发规范/database-migrations.md).

---

## (Optional but strongly recommended for China-hosted VPS) Mirror images to a domestic OCI registry

GHCR is in the US. From a 3Mbps Tencent-Cloud Lighthouse box, the first pull of
the full application image set is **~30 minutes** (limited by the trans-Pacific
link, not your bandwidth). Subsequent pulls are tiny because only changed layers
come down, but every first pull on a fresh VPS hurts.

Solution: let `mirror-images` copy the atomic GHCR release to a domestic OCI
registry after `build-images` completes. Changed components transfer their layers;
unchanged components only receive the new release tag inside the target registry.
Tencent TCR is the documented example, but `MIRROR_HOST` may point at another
OCI-compatible registry such as an Aliyun regional registry.

The Python image (`knowledge`) exports the service's locked
third-party requirements before installing dependencies. The export omits workspace
packages and annotations, so changes to unrelated workspace dependencies do not
invalidate the installed dependency layer when the exported requirements stay the
same. Runtime images copy that dependency environment first, install a separately
built `kernel` wheel in a small subsequent layer, and copy service code last.
Source-only changes therefore preserve the large dependency blob. Keep these layers
separate: copying a complete environment containing both dependencies and `kernel`
from a final builder stage would couple them again. A dependency or base-image update
can still require transferring the large layer; the first release with this new
layout also needs to upload it once.

### 1. Create TCR namespace (Tencent Cloud console, one-time, free)

1. 登录腾讯云 → 搜 "容器镜像服务" → 进 TCR
2. 左侧 "Personal Edition" → 启用(免费, 5 GB / 5 命名空间额度)
3. 在 "镜像仓库" → 创建命名空间,记下名字(例:`baymaxleee`)
4. 左侧 "访问凭证" → 创建一个长期凭证,记下:
   - **用户名** = 腾讯云账号 ID(纯数字,在用户头像下拉里有)
   - **密码** = 你刚生成的临时/长期密码

### 2. Set GitHub repo Variables + Secrets

GitHub repo → Settings → Secrets and variables → Actions:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `MIRROR_NAMESPACE` | `<your-tcr-namespace>` |
| Variable | `MIRROR_HOST` _(optional)_ | `ccr.ccs.tencentyun.com` _(default is fine; only change if you're in a non-Shanghai TCR region)_ |
| Secret | `MIRROR_USERNAME` | Registry account username |
| Secret | `MIRROR_PASSWORD` | Registry access credential from step 1.4 |

The next `build-images` run publishes GHCR first; `mirror-images` then transfers
only rebuilt components and retags unchanged component digests in TCR.

### Recover a failed cross-region mirror

Cross-region transfers to a domestic registry can fail on authentication resets,
HTTP/2 protocol errors, or interrupted blob copies. Inspect the failing job, then
use the repository command documented in
[`scripts/README.md`](../../scripts/README.md#registry-mirror-recovery) from a
machine whose Docker client is already logged in to the target registry:

```bash
just publish-images
```

This requires a clean worktree, verifies that the tag names current HEAD, compares
the immutable GHCR and domestic-registry digests, and updates `main` only after
every requested image matches exactly. The matching `build-images` run must finish
before this command. The project GHCR and Aliyun repository prefixes are fixed by
the command; Docker's credential store still owns authentication. Pass explicit
service names to resume a known subset. Never
place registry passwords in the command, repository, shell history, or CI logs.
Track `build-images`, `mirror-images`, and
`deploy-single-vps`; registry publication alone is not deployment success. A local
`linux/amd64` build without `--from` remains available as a fallback, but it cannot
guarantee GHCR-identical layer digests. See the tooling guide for build mirror
overrides and `--dry-run` usage.

### 3. One-time `docker login` on the VPS

TCR Personal Edition images are private (you can't make them public). Each VPS that pulls from TCR needs to authenticate **once** — the credential is then cached in `~/.docker/config.json` and all future pulls work without re-login:

```bash
ssh ubuntu@<vps-ip>
docker login ccr.ccs.tencentyun.com -u <tencent-account-id> -p '<tcr-password>'
```

### 4. Point deploys at TCR

`IMAGE_REGISTRY` is a deploy-time argument, so just change it when you deploy:

```bash
IMAGE_REGISTRY=ccr.ccs.tencentyun.com/baymaxleee \
  ./infra/single-vps/deploy.sh ubuntu@<vps-ip>
```

The next `docker compose pull` hits TCR instead of GHCR — first pull will finish in 1-3 minutes instead of 30. For CI, set the `IMAGE_REGISTRY` repo **Variable** to the TCR path.

> **Rollback**: if TCR ever has an outage, deploy again with `IMAGE_REGISTRY=ghcr.io/<owner>/<repo>`. GHCR is always still being pushed to as a fallback.

---

## Updating after code changes

Two ways:

### A. CI auto-deploy on every main push (recommended)

Set these GitHub **Secrets** once (Settings → Secrets and variables → Actions):

| Secret        | Value                                                                            |
| ------------- | -------------------------------------------------------------------------------- |
| `VPS_HOST`    | `<vps-ip>`                                                                       |
| `VPS_USER`    | `root` (or whichever user)                                                       |
| `VPS_SSH_KEY` | Full private key (multi-line, starts with `-----BEGIN OPENSSH PRIVATE KEY-----`) |

> No `VPS_ENV_FILE` and no age key in CI: the encrypted `secrets.sops.env` rides along in the repo and is decrypted **on the VPS** (which owns the age private key). CI only needs SSH access.

And optionally these **Variables**:

| Variable             | Default                           |
| -------------------- | --------------------------------- |
| `PUBLIC_PORT`        | `8080`                            |
| `PUBLIC_GATEWAY_URL` | `http://<VPS_HOST>:<PUBLIC_PORT>` |
| `DEPLOY_DIR`         | `/opt/monorepo`                   |
| `IMAGE_REGISTRY`     | (auto-derived from repo)          |

Done. Now every `git push origin main`:

1. `build-images.yml` runs backend/frontend/tooling/contract gates, builds only affected images, retags unchanged digests, and verifies a complete immutable GHCR release.
2. `mirror-images.yml` copies only rebuilt images to the optional operator registry and retags unchanged images without uploading their layers.
3. `deploy-single-vps.yml` reads the exact commit and tag from the release artifact, then SSH's to the VPS and deploys only after publication succeeds.
4. After the health check succeeds, the deploy removes images not referenced by any container.

Every component receives the same `sha-<short>` release tag even when its digest
was reused, so Compose keeps one atomic `IMAGE_TAG`. The registry remains the
rollback source of truth; the VPS keeps only images used by its current containers.

### B. Manual deploy from laptop

```bash
git pull origin main
# wait for build-images.yml to finish on GitHub
IMAGE_REGISTRY=ghcr.io/<owner>/<repo> ./infra/single-vps/deploy.sh root@<vps-ip>
```

### C. Manual deploy of a specific tag

GitHub → Actions → **deploy-single-vps** → Run workflow → enter `sha-abc12345` or `v1.2.3`.

---

## Day-2 operations

### Canonical maintenance access

The current passwordless maintenance entry point is:

```bash
ssh ubuntu@124.222.245.5
cd /opt/monorepo
```

Use direct SSH for read-only diagnosis and explicitly authorized reset-only
operations that must leave the stack stopped. Normal releases still go through
the deployment workflow.

### Recreate application data while retaining identity and operator configuration

Only after explicit user authorization, run the deployment workflow with the
current immutable image tag:

```bash
gh workflow run deploy-single-vps.yml --ref main \
  -f tag=sha-<HEAD8> \
  -f reset_application_data=true
```

This preserves the PostgreSQL `admin` and `iam` databases, but deletes Storage,
Canvas, Chat, Runtime, Workflow, Knowledge and Telemetry data, Redis sessions and
the Storage and ClickHouse data volumes. Never substitute `reset_data=true`, which
destroys the whole stack. Observe the resulting deployment through health checks.

### Look at what's running

```bash
ssh ubuntu@<vps-ip>
cd /opt/monorepo
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=80 gateway
```

### Restart one service

```bash
docker compose -f docker-compose.prod.yml restart gateway
```

### Wipe everything (data INCLUDED — be careful)

```bash
docker compose -f docker-compose.prod.yml down -v
```

### Backup Postgres

```bash
docker exec monorepo-postgres sh -c 'exec pg_dumpall -U workflow' > backup-$(date +%F).sql
```

### Backup all data volumes (cold backup; stop stack first)

```bash
docker compose -f docker-compose.prod.yml stop
tar czf /backup/monorepo-$(date +%F).tar.gz -C /var/lib/docker/volumes \
    monorepo_postgres_data monorepo_redis_data monorepo_knowledge_data
docker compose -f docker-compose.prod.yml start
```

---

## Troubleshooting

### Workflow Postgres 4.3.7 → 5.0.5: missing `run.attributes`

Version 4.3.7 recorded migration `0015` without `0011`–`0014`. Drizzle's timestamp cutoff skips those earlier migrations during the upgrade, so `0021` fails. `repair-workflow-4-to-5.sh` is a one-time, data-preserving repair for that exact history. It reads the four official SQL files from the failed init container's 5.0.5 image, backs up the `workflow` database, and applies the SQL and SHA-256 journal records in one transaction. Unexpected histories are rejected; repeating the repair before the official upgrade is a no-op.

Copy the script to the VPS deployment directory. Ensure no deployment job is running, then execute on the VPS:

```bash
cd /opt/monorepo
docker stop monorepo-runtime-worker monorepo-workflow-db-init
bash repair-workflow-4-to-5.sh
```

Keep the printed `workflow-repair.*/workflow.dump` backup. If repair succeeds, rerun the failed `deploy-single-vps` job with the same image tag to finish the official migrations and restart services. Do not start the worker before this upgrade. If repair fails, keep services stopped and inspect the error; do not delete migration records or reset volumes.

The script only repairs the Workflow World database; it does not alter service database baselines. Its regression check uses an isolated disposable PostgreSQL container and the official 4.3.7 package:

```bash
python3 infra/single-vps/tests/test-workflow-repair.py
```

This check requires Docker (`postgres:16-alpine`), Node.js, the Runtime workspace dependencies for the Workflow upgrade, and access to the npm registry.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `connection refused` from your laptop | Cloud security group port not open | Open `PUBLIC_PORT` in the cloud console |
| `502 Bad Gateway` from nginx | Backend pod still booting / crashed | `docker compose -f docker-compose.prod.yml logs gateway` |
| `db-init` stuck | Postgres still initializing | First boot can take 30–60 s; if longer, check `docker compose -f docker-compose.prod.yml logs postgres` |
| Backend containers CrashLoopBackoff | Postgres role password out of sync with `.env.secrets` | Re-run `deploy.sh` (or `bash render-env.sh && docker compose -f docker-compose.prod.yml up -d`) so `db-init` reconciles roles from the persisted `.env.secrets` |
| Authenticated API requests repeatedly return 401 | Expired session or inconsistent Gateway and IAM configuration | Check the Gateway and IAM logs for authentication errors. Verify both services use the same rendered secret reference in the [Compose manifest](docker-compose.prod.yml). |
| `render-env.sh` fails: age key not found | VPS not bootstrapped / key deleted | Re-run `bootstrap.sh` on the VPS; it regenerates `age.key` and reprints the public key (re-encrypt `secrets.sops.env` if the key changed) |
| `render-env.sh` fails: sops decrypt error | `.sops.yaml` public key ≠ the VPS's age key | Ensure `.sops.yaml` has the exact public key from `bootstrap.sh`, then `sops updatekeys infra/single-vps/secrets.sops.env` and redeploy |
| Pulling images is slow / fails | GHCR rate limit (free tier) | Sign in: `docker login ghcr.io -u <github-user>` (use a PAT with `read:packages`) |
| Out of memory under load | 4G RAM tight | Drop Postgres `shared_buffers`; lower telemetry SAMPLE_RATE_*; or upgrade to 4C8G |

---

## Migrating off

The persistent data is in these named Docker volumes:

- `monorepo_postgres_data`
- `monorepo_redis_data`
- `monorepo_storage_data`
- `monorepo_clickhouse_data`
- `monorepo_clickhouse_logs`

Backup the volumes, copy to a bigger box / K8s cluster, restore. The 10 images are immutable so you can re-tag and push elsewhere without rebuilding.

When you eventually move to `infra/k8s/`, the manifests there use the same images and environment contracts.

## Sandbox 执行环境

新增的内部 sandbox 服务需要预配置 gVisor 与隔离出口；K8s 另需独立执行 namespace、Cilium 与节点 PID 上限。部署、配额和验证命令见 [Sandbox 运行规范](../../docs/微服务/sandbox.md)。缺失 runtime/网络策略时不会回退为宿主机执行。
