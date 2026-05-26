# Single-VPS Deployment

Run the entire monorepo (frontend SPA + 4 backend services + MySQL/Redis) on **one VPS**, behind **one port** (no domain, no HTTPS, no Kubernetes). Browsers hit `http://<vps-ip>:8080` and get a fully-functional app.

> Telemetry storage was migrated from ClickHouse to MySQL in 2026-05 to keep the single-VPS footprint under 1 GB RAM. See `apps/backend/services/telemetry/AGENTS.md` for the trade-offs.

This path is intentionally **separate** from `infra/k8s/` — the K8s setup is for "future, when there are real users". Both coexist; pick one to deploy from.

---

## When to use this

| Use this when… | Use `infra/k8s/` when… |
|---|---|
| Demo / MVP / share with friends | Real production / paying users |
| ¥38–¥99 / year is the budget | ¥900+/month OK |
| One developer | Team of multiple |
| No domain, no备案 OK | Have domain + want HTTPS + compliance |
| 4C4G is the whole server | Multi-node, autoscaling |

---

## Architecture

```
browser
  │
  │ http://<vps-ip>:8080
  ▼
┌─────────────────────────────────────────────────────────┐
│  VPS (4C4G 推荐)                                          │
│                                                           │
│  ┌─────────────────────────────────────────────────┐     │
│  │ nginx (the `web` image — also serves SPA dist)   │     │
│  │   ├─ /              → platform dist (host SPA)   │     │
│  │   ├─ /mfe-admin/    → admin dist (MFE remote)    │     │
│  │   └─ /api/*         → gateway:8000               │     │
│  └─────────────────────────────────────────────────┘     │
│                  │                                        │
│      ┌───────────┴───────────┐                            │
│      ▼                       ▼                            │
│  gateway:8000          (db-init runs once)                │
│      ├─ iam:8002                                          │
│      ├─ admin:8001                                        │
│      └─ telemetry:8008                                    │
│                                                           │
│  mysql:3306    redis:6379                                 │
│  (volumes: /var/lib/docker/volumes/monorepo_*)            │
└─────────────────────────────────────────────────────────┘
```

All images are pulled from GHCR (or any custom registry); the VPS only stores config files and persistent data volumes — **no source code, no build toolchains**.

---

## Files in this directory

| File | Purpose |
|---|---|
| `docker-compose.prod.yml` | Stack definition (9 services) |
| `nginx.conf` | Web server config (baked into `web` image) |
| `Dockerfile.web` | Builds the nginx + frontend dist image |
| `Dockerfile.db-init` | Builds the one-shot schema migrator image |
| `mysql-init.sh` | Shell script run by `db-init` container (baked into image) |
| `.env.example` | Configuration template (copy to `.env`) |
| `bootstrap.sh` | Install Docker on a fresh VPS (run once, on VPS) |
| `deploy.sh` | Push config + restart containers (run from laptop / CI) |

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

This installs Docker, opens the OS firewall for port 8080. Idempotent.

### 2. Open the port in the cloud security group

OS firewall ≠ cloud security group. Go to your cloud console:

- **Aliyun 轻量** → 防火墙 → 添加规则 → TCP 8080
- **腾讯云 Lighthouse** → 防火墙 → 添加规则 → TCP 8080
- **火山引擎 ECS** → 安全组 → 入方向 → TCP 8080
- **Vultr / Hetzner** → no security group by default; OS firewall is enough

### 3. Configure .env (run on your laptop)

```bash
cd /path/to/monorepo
cp infra/single-vps/.env.example infra/single-vps/.env
$EDITOR infra/single-vps/.env
```

Fill in (minimum):
- `IMAGE_REGISTRY` — your GHCR path, e.g. `ghcr.io/yourname/yourrepo` (lowercase!)
- `MYSQL_ROOT_PASSWORD` — `openssl rand -base64 24`
- `MYSQL_PASSWORD` — different from root
- `ACCESS_TOKEN_SECRET` — `openssl rand -hex 32`
- `SUPER_ADMIN_PASSWORD` — your initial login password

### 4. Trigger CI to build the images (if not already)

```bash
git push origin main
# wait ~5 minutes — watch GitHub Actions → build-images go green
```

You should see 6 images in your repo's **Packages** tab: `gateway`, `iam`, `admin`, `telemetry`, `web`, `db-init`.

### 5. Deploy (run on your laptop)

```bash
./infra/single-vps/deploy.sh root@<vps-ip>
```

Output ends with the URL to open in a browser.

---

## Updating after code changes

Two ways:

### A. CI auto-deploy on every main push (recommended)

Set these GitHub **Secrets** once (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `VPS_HOST` | `<vps-ip>` |
| `VPS_USER` | `root` (or whichever user) |
| `VPS_SSH_KEY` | Full private key (multi-line, starts with `-----BEGIN OPENSSH PRIVATE KEY-----`) |
| `VPS_ENV_FILE` | Full content of your `infra/single-vps/.env` (paste as-is, multi-line) |

And optionally these **Variables**:

| Variable | Default |
|---|---|
| `PUBLIC_PORT` | `8080` |
| `DEPLOY_DIR` | `/opt/monorepo` |
| `IMAGE_REGISTRY` | (auto-derived from repo) |

Done. Now every `git push origin main`:
1. `build-images.yml` builds & pushes the 6 images
2. `deploy-single-vps.yml` waits for build-images success, then SSH's to the VPS and runs the deploy

The CI overrides `IMAGE_TAG` to the just-built `sha-<short>` so each deploy is pinned to the commit that triggered it.

### B. Manual deploy from laptop

```bash
git pull origin main
# wait for build-images.yml to finish on GitHub
./infra/single-vps/deploy.sh root@<vps-ip>
```

### C. Manual deploy of a specific tag

GitHub → Actions → **deploy-single-vps** → Run workflow → enter `sha-abc12345` or `v1.2.3`.

---

## Day-2 operations

### Look at what's running

```bash
ssh root@<vps-ip>
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

### Backup MySQL

```bash
docker exec monorepo-mysql sh -c 'exec mysqldump --all-databases -uroot -p"$MYSQL_ROOT_PASSWORD"' > backup-$(date +%F).sql
```

### Backup all data volumes (cold backup; stop stack first)

```bash
docker compose -f docker-compose.prod.yml stop
tar czf /backup/monorepo-$(date +%F).tar.gz -C /var/lib/docker/volumes \
    monorepo_mysql_data monorepo_redis_data
docker compose -f docker-compose.prod.yml start
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `connection refused` from your laptop | Cloud security group port not open | Open `PUBLIC_PORT` in the cloud console |
| `502 Bad Gateway` from nginx | Backend pod still booting / crashed | `docker compose logs gateway` |
| `db-init` stuck | MySQL still initializing | First boot can take 30–60 s; if longer, check `docker compose logs mysql` |
| 4 backend pods CrashLoopBackoff | Probably bad MYSQL_PASSWORD in `.env` | Re-edit `.env`, `docker compose up -d` |
| Frontend loads but API returns 401 forever | `ACCESS_TOKEN_SECRET` differs between gateway and iam (impossible if `.env` is shared) | `docker compose exec gateway env \| grep ACCESS_TOKEN`, ditto for iam |
| Pulling images is slow / fails | GHCR rate limit (free tier) | Sign in: `docker login ghcr.io -u <github-user>` (use a PAT with `read:packages`) |
| Out of memory under load | 4G RAM tight | Drop MySQL `--innodb-buffer-pool-size`; lower telemetry SAMPLE_RATE_*; or upgrade to 4C8G |

---

## Migrating off

The persistent data is in two named Docker volumes:
- `monorepo_mysql_data`
- `monorepo_redis_data`

Backup the volumes, copy to a bigger box / K8s cluster, restore. The 6 images are immutable so you can re-tag and push elsewhere without rebuilding.

When you eventually move to `infra/k8s/`, the manifests there were already validated against the same image shapes — `MYSQL_HOST` / `REDIS_HOST` env vars are identical, just pointed at K8s service DNS instead of Docker network DNS.
