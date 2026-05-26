# 上线准备清单 (Phase 1)

把项目从 demo 推到公网的所有**手动**操作清单。**代码 / manifest / CI workflow 部分已就绪**,本文档只列你需要在浏览器里点的事。

按"成本从低到高、能并行做的尽量并行"的顺序排列。

---

## 🟢 阶段 0:本地验证(0 元,15 分钟)

目的:在花钱之前,确认 K8s manifest 设计是对的、CI workflow 是对的。

### 0.1 装 kind(本地 K8s in Docker)

```bash
brew install kind         # macOS
# 或参考 https://kind.sigs.k8s.io/
```

### 0.2 用 kind 跑一遍 prod manifest

```bash
# dry-run 模式 — 不真起 pod,只验证 manifest 通过 kube-apiserver 校验
just k8s-kind

# 想真起 pod(会 build 4 个镜像并 load 进 kind,耗时 5~10 分钟)
just k8s-kind --apply --build
```

成功后访问:

```bash
curl -k --resolve api.local.test:8443:127.0.0.1 https://api.local.test:8443/livez
# 应返回 {"status":"ok"}
```

清理:`just k8s-kind-down`

### 0.3 跑通 CI 镜像构建

```bash
# push 一次 main,触发 build-images workflow
git push origin main
# 看 GitHub Actions → build-images:4 个矩阵 job 全绿 → 镜像已推到 ghcr.io
```

GHCR 默认是免费的,镜像会出现在你 GitHub repo 的 **Packages** tab。**不需要**配任何 secret。

---

## 🟡 阶段 1:域名 + Cloudflare(¥80/年,30 分钟)

### 1.1 注册域名

任选一家:
- **Cloudflare Registrar** — 成本价(.com 约 $9.5/年),买完直接在 Cloudflare 管理
- **Namesilo** — 国际,便宜,无隐私费
- **阿里云万网** — 国内主流,如果**未来要走 ICP 备案**(国内访问稳定)推荐这个

### 1.2 域名接入 Cloudflare

如果不在 Cloudflare 买:把域名的 NS 改成 Cloudflare 提供的两个(用 Free Plan 就够)。

### 1.3 SSL/TLS 模式

Cloudflare Dashboard → 你的域名 → **SSL/TLS → Overview**:
- 模式选 **Full (strict)**
- **SSL/TLS → Origin Server → Create Certificate** → 生成 Origin CA Certificate
- 把 `origin.pem` 和 `origin.key` 下载下来,稍后(阶段 3.2)上传到 K8s 集群

### 1.4 暂时不创建 DNS A 记录

(因为后端集群还没建,IP 还不知道。阶段 3.3 再回来填)

---

## 🟡 阶段 2:Cloudflare Pages 部署前端(¥0,20 分钟)

### 2.1 创建 platform host 的 Pages project

Cloudflare Dashboard → **Workers & Pages → Create application → Pages → Connect to Git** → 选这个 repo。

| 配置项 | 值 |
|---|---|
| Build command | `bash scripts/build-frontend-static.sh` |
| Build output | `apps/frontend/apps/platform/dist` |
| Root directory | `/` |
| Environment variables (Production) | 见下表 |

**Production env vars**:

| Key | Value | 说明 |
|---|---|---|
| `APP` | `platform` | (默认值,可省) |
| `API_BASE_URL` | `https://api.your-domain.com` | 必填,会被打进 bundle |
| `MFE_ADMIN_ENTRY` | `mfe_admin@https://mfe-admin.your-domain.com/mf-manifest.json` | 必填,指向 mfe-admin 的 manifest 地址 |
| `APP_RELEASE` | `${CF_PAGES_COMMIT_SHA}` | 用于 telemetry 区分版本 |
| `NODE_VERSION` | `22` | mise.toml 里是 22 |

Custom domain: `app.your-domain.com`

### 2.2 创建第 2 个 Pages project for mfe-admin

| 配置项 | 值 |
|---|---|
| Build command | `bash scripts/build-frontend-static.sh` |
| Build output | `apps/frontend/apps/admin/dist` |
| Environment variables | `APP=admin`, `NODE_VERSION=22` |

Custom domain: `mfe-admin.your-domain.com`

> **为什么两个 project?** Module Federation 的 remote 是独立部署单元,每个 remote 有自己的 release cycle。两个 Pages project 让 platform 和 mfe-admin 能各自独立发版,符合 MFE 哲学。

> **mfe-admin 需要 CORS?** Cloudflare Pages 默认会设 `Access-Control-Allow-Origin: *`,适用于静态资源,**不用额外配置**。

### 2.3 验证(还没后端,只看页面能加载)

打开 `https://app.your-domain.com` → 至少能看到 platform 的登录页或某个静态 UI(API 调用会失败,正常)。

---

## 🔴 阶段 3:火山引擎集群购买 + 部署(¥900~1500/月,2~3 小时)

### 3.1 购买清单

进 [火山引擎控制台](https://console.volcengine.com/),按顺序开通:

| 步骤 | 产品 | 推荐规格 | 注意 |
|---|---|---|---|
| 1 | **私有网络 VPC** | 默认 | 后续所有资源都建在这个 VPC 内 |
| 2 | **VKE 容器服务** | 集群版本 1.28+,2~3 个 4C8G ECS 节点 | 选标准版,Kubernetes 控制平面火山免费托管 |
| 3 | **CR 容器镜像** | 个人版(免费) | 创建 namespace `monorepo` |
| 4 | **云数据库 MySQL** | 1C2G,40GB | 建在和 VKE 同 VPC,白名单只放集群 |
| 5 | **缓存数据库 Redis** | 256MB 主从 | 同上 |

把 2 个 endpoint(MySQL host、Redis host)+ 各自账号密码记录下来。
telemetry 服务复用同一个 MySQL,只用自己的 `telemetry` database。

### 3.2 集群一次性初始化

```bash
# 下载 kubeconfig(火山 VKE 控制台 → 集群 → 连接信息)
export KUBECONFIG=~/.kube/vke-prod-config
kubectl get nodes   # 看到节点 = 通了

# 装 Nginx Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml

# 等 LB 公网 IP 出来
kubectl -n ingress-nginx get svc ingress-nginx-controller -w
# 拿到 EXTERNAL-IP 后,回 Cloudflare 加 DNS:
#   A  api.your-domain.com  → <LB EXTERNAL-IP>  (orange cloud / proxied)

# 创建 namespace 和 Secrets(替换 <...>)
kubectl create ns monorepo-prod

kubectl -n monorepo-prod create secret generic gateway-secrets \
  --from-literal=MYSQL_HOST=<rds-endpoint> \
  --from-literal=MYSQL_USER=gateway \
  --from-literal=MYSQL_PASSWORD=<from-1Password> \
  --from-literal=REDIS_HOST=<redis-endpoint> \
  --from-literal=ACCESS_TOKEN_SECRET=$(openssl rand -hex 32)

kubectl -n monorepo-prod create secret generic iam-secrets \
  --from-literal=MYSQL_HOST=<rds-endpoint> \
  --from-literal=MYSQL_USER=iam \
  --from-literal=MYSQL_PASSWORD=<from-1Password> \
  --from-literal=ACCESS_TOKEN_SECRET=<SAME as gateway above>

kubectl -n monorepo-prod create secret generic admin-secrets \
  --from-literal=MYSQL_HOST=<rds-endpoint> \
  --from-literal=MYSQL_USER=admin \
  --from-literal=MYSQL_PASSWORD=<from-1Password> \
  --from-literal=REDIS_HOST=<redis-endpoint>

kubectl -n monorepo-prod create secret generic telemetry-secrets \
  --from-literal=MYSQL_HOST=<rds-endpoint> \
  --from-literal=MYSQL_USER=telemetry \
  --from-literal=MYSQL_PASSWORD=<from-1Password>

# 上传 Cloudflare Origin CA cert(阶段 1.3 下载的)
kubectl -n monorepo-prod create secret tls api-tls \
  --cert=origin.pem --key=origin.key
```

### 3.3 把 manifest 占位符换成真值

```bash
# REPLACE_ME_REGISTRY → 火山 CR
sed -i '' "s|REPLACE_ME_REGISTRY|cr-cn-<region>.volces.com|g" \
  infra/k8s/overlays/prod/kustomization.yaml

# your-domain.com → 真实域名(2 个文件)
grep -rl "your-domain.com" infra/k8s/overlays/prod/ \
  | xargs sed -i '' "s/your-domain.com/<YOUR REAL DOMAIN>/g"

# 验证渲染
just k8s-render prod | less
```

### 3.4 GitHub Actions 配置

Repo Settings → **Secrets and variables → Actions**:

| 类型 | 名称 | 值 |
|---|---|---|
| Variable | `IMAGE_REGISTRY` | `cr-cn-<region>.volces.com/monorepo` (切换到火山 CR) |
| Secret | `REGISTRY_USERNAME` | 火山 CR robot 账号 |
| Secret | `REGISTRY_PASSWORD` | 火山 CR robot 密码 |
| Secret | `KUBECONFIG_PROD` | `base64 -i ~/.kube/vke-prod-config` 输出的字符串 |

Settings → **Environments → New environment** → `production`:
- 勾选 "Required reviewers" → 添加你自己 → 这样 deploy-prod 需要手动批准

### 3.5 首次部署

```bash
# 1) push 触发 build-images,等 4 个镜像推到 CR
git commit --allow-empty -m "chore: trigger build"
git push origin main

# 2) GitHub Actions → "deploy-prod" → Run workflow
#    Input: tag = sha-<刚才 push 的 short sha>
#    在 production environment 批准
```

部署完成后:

```bash
curl https://api.your-domain.com/livez
# {"status":"ok"}
```

打开 `https://app.your-domain.com` 完整链路应该通了。

---

## 📋 上线后 24 小时内必做(Phase 2 minimum)

- [ ] Cloudflare → **WAF → Managed Rules** → enable "Cloudflare Managed Ruleset"
- [ ] Cloudflare → **Security → Bot Fight Mode** → enable
- [ ] 集群里:`kubectl -n monorepo-prod top pods` 看资源用量,调整 requests/limits
- [ ] 加监控:火山引擎日志服务 TLS 接管 stdout,或装 prometheus-operator
- [ ] 备份:RDS 控制台开自动备份 / 设保留天数

---

## 🛟 出问题查这里

| 症状 | 排查命令 |
|---|---|
| 前端访问白屏 | 浏览器 Console 看 API 请求 URL 是否对 / Network 看 mf-manifest.json 能否加载 |
| API 502 | `kubectl -n monorepo-prod logs deploy/gateway --tail=100` |
| Pod CrashLoopBackoff | `kubectl -n monorepo-prod describe pod <pod>` 看 events |
| Login 后立即跳回登录页 | 大概率 Cookie 跨域失败,看浏览器 Application → Cookies 是否有 `refresh_token`,domain 是否对、SameSite 是否 None |
| CORS preflight 失败 | gateway log 看 `ALLOWED_FRONTEND_ORIGINS` 是不是真的包含前端域名 |
