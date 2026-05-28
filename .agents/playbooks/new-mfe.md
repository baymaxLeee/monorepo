# Playbook: New micro-frontend

接入一个新的 MFE（`apps/frontend/apps/<name>/`）时，请逐项勾掉以下清单。
参考实现：`apps/frontend/apps/admin/`。

## A. MFE 骨架

```
[ ] apps/frontend/apps/<name>/package.json          # name = "<name>"，依赖对齐 admin
[ ] apps/frontend/apps/<name>/tsconfig.json
[ ] apps/frontend/apps/<name>/rspack.config.mjs     # uniqueName: "mfe_<name>"，filename: "remoteEntry.js"，exposes: { "./App": "./src/App.tsx" }，devServer.port 唯一
[ ] apps/frontend/apps/<name>/src/types.d.ts        # declare module "*.css"
[ ] apps/frontend/apps/<name>/src/App.tsx + router + layout + 至少一个页面
[ ] apps/frontend/apps/<name>/AGENTS.md             # 仿 admin
[ ] apps/frontend/apps/<name>/Dockerfile
```

## B. 平台 host 接入

```
[ ] apps/frontend/apps/platform/src/registry.ts                   # 添加 MFE 条目（唯一真源）
[ ] apps/frontend/apps/platform/rspack.config.mjs                 # 定义 MFE_<NAME>_ENTRY 默认值；ModuleFederationPlugin.remotes 加 mfe_<name>
[ ] apps/frontend/apps/platform/src/router/index.tsx              # remoteAppLoaders 加 mfe_<name>
[ ] apps/frontend/apps/platform/src/types.d.ts                    # declare module "mfe_<name>/App"
```

> Layout 顶部导航直接遍历 `registry`，不需要额外注册。
> MFE 入口的唯一真源就是 `registry.ts`，不要在 store / localStorage 中再存一份"菜单列表"，否则改 registry 后老浏览器看不到新入口。

## C. 端口与 dev 编排

```
[ ] apps/frontend/justfile             # PORTS map 加 <name>: <port>
[ ] Procfile.dev                       # 新增 mfe-<name>: ... 进程；platform 进程依赖该 MFE 的 mf-manifest.json
[ ] scripts/dev-stack.sh               # DEV_PORTS 加 <port>；启动命令加 mfe-<name>
[ ] justfile (root) dev-urls           # 打印新 MFE 的 URL
```

## D. API client（仅当连后端）

```
[ ] apps/frontend/packages/api/orval.config.ts            # 新增 <name>-server block，input 指向 schemas/openapi/<name>-server.json
[ ] apps/frontend/packages/api/scripts/codegen.sh         # 加 schema 存在性 guard
[ ] apps/frontend/packages/api/src/<name>-server.ts       # 手写补丁（如 SSE、Orval 覆盖不到的情况）
[ ] apps/frontend/packages/api/src/index.ts               # re-export
```

## E. k8s

```
[ ] infra/k8s/base/mfe-<name>/{deployment,service,configmap,kustomization}.yaml
[ ] infra/k8s/overlays/dev/kustomization.yaml      # resources + images
[ ] infra/k8s/overlays/prod/kustomization.yaml     # resources + images + 可能的 patches
```

## F. single-VPS

```
[ ] infra/single-vps/docker-compose.prod.yml      # 顶部架构注释里的 /mfe-<name>/ 行；如果 MFE 独立打成镜像还要新增 service
[ ] infra/single-vps/Dockerfile.web               # 增加 MFE_<NAME>_ENTRY ARG/ENV；先 build remote 再 build platform；COPY 该 MFE 的 dist 到 /usr/share/nginx/html/mfe-<name>
[ ] infra/single-vps/nginx.conf                   # 增加 location /mfe-<name>/ 块
```

## G. CI（`.github/workflows/`）

```
[ ] build-images.yml          # matrix.service 加 <name>（如果 MFE 独立打镜像，否则只要 web 包含即可）
[ ] frontend.yml              # build 步骤补 pnpm -F <name> build
[ ] deploy-prod.yml           # services 列表加 <name>（k8s 部署/rollout）
[ ] deploy-single-vps.yml     # 单 VPS 通过 docker-compose 滚动，不一定要改；如果新增独立镜像，则补
```

## H. 文档

```
[ ] docs/微前端/<name>.md
[ ] docs/微前端/index.md             # 架构图 + 模块表
```

## 验证（必须全过）

```
just install
just sync
just fmt
just lint
pnpm -F platform build
pnpm -F <name> build
kubectl kustomize --load-restrictor=LoadRestrictionsNone infra/k8s/overlays/dev | grep "name: mfe-<name>"
docker compose -f infra/single-vps/docker-compose.prod.yml config >/dev/null
just dev    # 在浏览器里确认 layout 顶部出现 <name> 入口，点进去能加载 remoteEntry.js
```

## 硬规则

- 不准 import 其他 MFE
- 跨 MFE 通信用 `runtime` 的事件总线
- 调后端用 `packages/api/<svc>`，禁止裸 `fetch`（SSE 等 Orval 覆盖不到的除外）
- MFE 入口列表只来自 `registry.ts`，不要持久化到 store
