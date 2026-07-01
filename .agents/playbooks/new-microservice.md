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
[ ] Python: apps/backend/pyproject.toml         # [tool.uv.workspace] members 加 "services/<name>"
[ ] Node:   apps/backend/pnpm-workspace.yaml    # packages 加 "services/<name>"
[ ] apps/backend/justfile                 # PY_SERVICES 或 NODE_SERVICES + PORTS map 加 <name>
[ ] scripts/install-deps.sh               # .env 拷贝循环加 services/<name>/.env.example
[ ] scripts/db-bootstrap.sh               # 建库 + 可选的 demo seed
```

Node 服务额外要求 `package.json` 里有 **`lint`** 脚本（不只是 `typecheck`）——
`just lint` 通过 `lint-node` 无条件对 `NODE_SERVICES` 里每一个服务跑
`pnpm run lint`，缺这个 script 会让 `just lint` 对全仓库报错退出（见
ADR-0015 的教训：`executor` 加入 `NODE_SERVICES` 后这个洞踩了一整个 phase 都
没发现，因为没人在那之前跑过一次全量 `just lint`）。最简单的写法是
`"lint": "tsc -p tsconfig.json --noEmit"`，和 `typecheck` 保持同一份实现。

## C. 网关接入（不接的话浏览器直接 404 / CORS）

仅当浏览器需要直接/间接（经其他服务代理）触达这个服务时才需要。纯内部服务
（只被其他后端服务调用，浏览器永远不直接感知，例如 `executor`）跳过整个 C 节，
但仍然要走 D/F/G/H —— "内部服务" 不等于 "跳过部署配置"。

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

如果新服务需要一个 MySQL 之外的专用存储（例如 executor 的 Workflow
World Postgres），**只**加进 `docker-compose.prod.yml`（和对应 k8s
manifest），不要加进根目录共享的本地 `docker-compose.yml`——本地开发默认
应该用更轻的降级方案（文件系统 / 内存 / SQLite 等），除非有本地场景真的用
得上那个容器。给本地环境加一个没有任何本地代码路径会用到的容器，是纯粹的
`just up` 变慢和心智负担。

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
- ❌ 只跑了新服务自己的 lint/typecheck，没跑过一次全仓库 `just lint` —— 漏了
  Node 服务缺 `lint` script 这种"新服务把公共命令搞挂"的问题
- ❌ 新服务是别的服务（比如 chat）拆出来的功能，却没检查旧服务里调用这块领域
  逻辑的其他调用方（`claim`/`renew`/`phase` 之类的协调型端点特别容易在搬迁后
  变成没有调用方的死代码，而且经常活在这次任务完全没打开过的第三个服务里）
- ❌ 把"已知限制"写进文档前没有实测：多阶段任务收尾时，用真实请求验证一遍
  你准备写进 ADR "Not yet done" 的每一条，很可能它已经被底层依赖解决了（例
  如本任务里 workflow 的取消延迟，实测后发现是秒级而非"等当前 block 跑完"）
