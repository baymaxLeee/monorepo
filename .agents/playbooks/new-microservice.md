# Playbook: New microservice

接入一个新的后端服务（`apps/backend/services/<name>/`）时，请逐项勾掉以下清单。
参考实现：`apps/backend/services/admin/`（Python / FastAPI）。

## 前置确认

- 服务名 / 语言（默认 Python FastAPI）
- 拥有哪个 DB（每个服务独占自己的 DB / schema）
- 端口（从 `apps/backend/justfile` 的 PORTS map 选一个未占用的）
- 上下游与传输方式（HTTP / gRPC / SSE / 事件）

## A. 服务骨架

```
[ ] apps/backend/services/<name>/pyproject.toml
[ ] apps/backend/services/<name>/.env.example          # PORT、MYSQL_DB、REDIS_DB、其他上游凭据
[ ] apps/backend/services/<name>/Dockerfile
[ ] apps/backend/services/<name>/AGENTS.md
[ ] apps/backend/services/<name>/src/<name>/
    [ ] main.py（FastAPI app + lifespan）
    [ ] config.py / db.py / redis_client.py / deps.py
    [ ] models/ schemas/ crud/ services/ routers/
    [ ] routers/health.py            # /livez /readyz /healthz
    [ ] gen_openapi.py
[ ] apps/backend/services/<name>/migrations/versions/v1.0.0.sql
```

## B. workspace / 工具链注册

```
[ ] apps/backend/pyproject.toml           # [tool.uv.workspace] members 加 "services/<name>"
[ ] apps/backend/justfile                 # PY_SERVICES + PORTS map 加 <name>
[ ] scripts/install-deps.sh               # .env 拷贝循环加 services/<name>/.env.example
[ ] scripts/db-bootstrap.sh               # 建库 + 可选的 demo seed
```

## C. 网关接入（不接的话浏览器直接 404 / CORS）

```
[ ] apps/backend/services/gateway/internal/config/config.go    # <Name>ServiceURL + envOr("<NAME>_SERVICE_URL", "http://localhost:<port>")
[ ] apps/backend/services/gateway/cmd/server/main.go           # r.Mount("/api/<name>-server", handlers.NewServiceProxy(...))
[ ] apps/backend/services/gateway/.env.example                 # <NAME>_SERVICE_URL=http://localhost:<port>
```

## D. dev 编排

```
[ ] Procfile.dev                       # 新增 svc-<name>
[ ] scripts/dev-stack.sh               # DEV_PORTS 加 <port>；启动命令加 svc-<name>
[ ] justfile (root) dev-urls           # 打印 svc-<name> 的 URL
```

## E. 契约 / OpenAPI

```
[ ] apps/backend/services/<name>/src/<name>/gen_openapi.py   # 输出到 schemas/openapi/<name>-server.json
[ ] 验证：cd apps/backend && just gen-openapi <name>
[ ] 在仓库根运行 just sync 让前端 client 同步
```

## F. k8s

```
[ ] infra/k8s/base/<name>/{deployment,service,configmap,secret,kustomization}.yaml
[ ] infra/k8s/overlays/dev/kustomization.yaml      # resources + images
[ ] infra/k8s/overlays/prod/kustomization.yaml     # resources + images + patches
[ ] infra/k8s/overlays/prod/patches/<name>-config.yaml
[ ] infra/k8s/overlays/prod/patches/replicas.yaml  # 加 <name> 副本数块
```

## G. single-VPS

```
[ ] infra/single-vps/docker-compose.prod.yml       # 新增 <name> 服务；gateway env 加 <NAME>_SERVICE_URL；顶部架构注释更新
[ ] infra/single-vps/Dockerfile.db-init            # COPY services/<name>/migrations/versions 到 /schema/<name>
[ ] infra/single-vps/mysql-init.sh                 # DATABASES 加 <name>
[ ] infra/single-vps/.env.example                  # 新服务需要的 env 模板（可选）
```

## H. CI（`.github/workflows/`）

```
[ ] build-images.yml          # matrix.service 加 <name>；如果是 Python 服务，把它归到 "context = apps/backend" 分支
[ ] deploy-prod.yml           # Pin image tags + Wait for rollouts 两处的服务列表都加 <name>
[ ] deploy-single-vps.yml     # 通过 docker-compose 滚动一般不用改；如有 pull/up 列表则补
```

> `backend.yml` 的 lint / format / mypy 会自动扫 `services/` 全目录，新服务无需改 workflow。
> `contracts.yml` 走 `just gen-openapi-all` + diff，也是自动覆盖。

## I. 文档

```
[ ] docs/微服务/<name>.md
[ ] docs/微服务/index.md       # 服务表加一行
```

## 验证（必须全过）

```
just install
just up
just sync
just fmt
just lint
cd apps/backend && just gen-openapi <name>
kubectl kustomize --load-restrictor=LoadRestrictionsNone infra/k8s/overlays/dev | grep "name: <name>"
docker compose -f infra/single-vps/docker-compose.prod.yml config >/dev/null
just dev      # 全栈起得来；dev-urls 出现 svc-<name>；网关代理 /api/<name>-server/* 通
```

## 反模式

- ❌ 通过 `libs/` 跨服务共享 domain model
- ❌ 直接读写其他服务的 DB
- ❌ 忘记网关代理 → 前端 CORS / 404
- ❌ 忘了 single-vps / CI 入口 → 本地能跑但发不出去
- ❌ 忘了 `scripts/db-bootstrap.sh` → 新人执行 `just up` 时 "unknown database"
