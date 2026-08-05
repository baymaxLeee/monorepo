# Monorepo Demo

面向 AI 全栈 agent 的 **微前端 + 微服务** 元仓库示范。
单 agent 单上下文跨栈干活,多语言各用原生 workspace,跨栈契约走 `schemas/`。

---

## 🚀 快速上手(第一次跑就看这里)

> 第一次进项目走完这一节;后续日常开发只用下面的「三条命令」即可。

```bash
cd /Users/bytedance/projects/project/monorepo

# 1. 装工具版本管理器(强烈推荐,仅需一次)
brew install mise                                          # 或 curl https://mise.run | sh
mise use --global node@24.18.0 pnpm@11.9.0
grep -qxF 'eval "$(mise activate zsh --shims)"' ~/.zprofile 2>/dev/null || echo 'eval "$(mise activate zsh --shims)"' >> ~/.zprofile
grep -qxF 'eval "$(mise activate zsh)"' ~/.zshrc 2>/dev/null || echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
eval "$(mise activate zsh)"
# 2. 一键安装所有依赖(mise 工具链 + 前后端包 + .env 模板)
just install

# 3. (推荐)装进程管理器,让 `just dev` 体验更好
brew install overmind tmux                                 # 每个服务独立日志面板,可单独 attach

# 4. 起本地基础设施(Docker + 建库 + schema)
just up

# 5. 验证环境
just doctor

# 6. 起全套服务
just dev
```

Codex CLI 使用官方 standalone 安装（`curl -fsSL https://chatgpt.com/codex/install.sh | sh`），
不要通过 `npm install -g` 安装到某个 Node 版本目录中。

`just install` 帮你做了:
- 脚本可执行权限、`mise install`
- `pnpm install`(前端)、`uv sync`(后端 Python)、Go services `go mod tidy`
- 从 `.env.example` 复制缺失的 `.env`

`just up` 帮你做了:
- `docker compose up -d`(Redis + Postgres/pgvector — 业务库 + Workflow World + knowledge 向量)
- 业务建库和 admin schema/种子数据,以及 `executor` 用的 Workflow World
  （`@workflow/world-postgres`）schema——本地和每个部署环境(single-vps /
  k8s)跑同一个 Postgres World,不默认退化成文件系统 Local World,保持
  本地/生产行为一致,见 `docs/微服务/executor.md`。

跑完之后浏览器打开 **http://localhost:3000**,就能看到完整跨栈链路:

```
浏览器 :3000
  └─ platform 通过 Module Federation 加载 mfe-chat / mfe-admin
       └─ mfe-chat 调 gateway http://localhost:8000/v1/...
            └─ gateway 反向代理到 chat / admin / knowledge / executor
                 └─ chat agent 流式返回，artifact 写入 knowledge
```

| 服务 | URL | 角色 |
|---|---|---|
| platform | http://localhost:3000 | 微前端 host（主壳） |
| mfe-admin | http://localhost:3001 | 管理台 remote |
| mfe-chat | http://localhost:3005 | 对话 remote |
| gateway | http://localhost:8000 | Go API 网关 |
| iam | http://localhost:8002/healthz | 身份 / 组织 |
| svc-admin | http://localhost:8001/docs | 配置平面（providers / skills） |
| svc-chat | http://localhost:8009/docs | Agent 运行时 |
| knowledge | http://localhost:8010/healthz | 文档 / RAG / artifact 存储 |
| executor | http://localhost:8011/healthz | 长任务（HTML artifact / 视频） |

> 不想装 mise?自己装齐 `node@24.18.0 / pnpm@11.9.0 / python@3.14.5 / uv / go@1.26.3 / just / docker / jq` 也行。
> 不想装 overmind?`just dev` 会自动回退到纯 shell 模式,功能一样,只是日志混在一起。

---

## ⚡ 日常三条命令

> 装好之后,你每天写代码只需要这三条:

```bash
just install # 首次 clone:装齐 mise/pnpm/uv/go 与所有 workspace 依赖
just up      # 起 Docker + 建库 + schema
just dev     # 起全套服务(platform + mfe-admin + mfe-chat + gateway + 后端微服务),Ctrl+C 全停
just down    # 收工,关 docker
```

---

## 🧰 技术栈速览

- **前端**:React 18 + TypeScript + Rspack + **Module Federation 2.0**(`platform` host + `admin` / `chat` remotes)
- **后端**:Python 3.14 + FastAPI(微服务) + Go 1.26 + chi(API Gateway)
- **包管理**:pnpm(FE) · uv(Py) · go.work
- **任务编排**:[just](https://just.systems) + [mise](https://mise.jdx.dev)
- **跨栈契约**:OpenAPI(自动导出)+ Protobuf(Buf)+ CloudEvents
- **Agent 规范**:`AGENTS.md`(通用,无 CLAUDE.md / .cursorrules)

---

## ⚙️ 常用命令

都从根目录跑:

| 命令 | 干啥 |
|---|---|
| `just dev` | **起全套服务**,Ctrl+C 全停 ⭐ |
| `just dev-shell` | 同上,但用纯 shell 模式(无 overmind 时的 fallback) |
| `just dev-urls` | 列出所有服务的 URL |
| `just up` / `just down` | 起 / 关 docker(Redis + Postgres/pgvector) |
| `just install` | 装所有依赖(前端 + 后端 Py + Go) |
| `just build` | **全栈构建**(前端 dist + Go 二进制) |
| `just build <target>` | 单目标构建:`platform` / `admin` / `chat` / `gateway` / `frontend` / `backend` |
| `just build-images [registry] [tag]` | 后端所有服务打 docker 镜像 |
| `just sync` | 后端导出 OpenAPI → 前端重新生成 TS 客户端 ⭐ |
| `just fmt` | 全栈格式化(ruff + Oxfmt + gofmt,仅在确有格式漂移时运行) |
| `just lint` | 全栈 lint |
| `just check` | lint + 契约生成一致性检查 |
| `just status` | git + PR 状态总览 |
| `just doctor` | 体检:工具 + docker 服务 |

子目录里有更细粒度的命令(只起一个服务、只测一个包):

```bash
# 前端
cd apps/frontend
just dev platform              # 单起 platform
just dev admin                 # 单起 mfe-admin
just dev chat                  # 单起 mfe-chat
just build                     # build 全部(turbo orchestrates)
just build platform            # 只 build platform
just build chat                # 只 build chat remote
just lint                      # Oxlint/Oxfmt check + TS7 + boundaries
just gen-client                # 重新生成 @repo/api/generated

# 后端
cd apps/backend
just dev admin              # 单起 Python admin 服务
just dev gateway            # 单起 gateway
just build                  # Go 二进制 + 全部 docker 镜像
just build gateway          # 只 build Go 二进制 → services/gateway/bin/server
just build admin            # Python "build":lint + 导 OpenAPI 预检
just build-image admin      # docker build 单个服务 → local/admin:latest
just build-images           # 全部服务的 docker 镜像
just lint admin             # 单服务 ruff + mypy
just gen-openapi admin      # 导出 OpenAPI 到 schemas/openapi/admin-server.json
just migrate-new admin v1.1.0        # 新建服务内 SQL migration
just migrate-up admin v1.1.0         # 应用 (current, target] 范围内的 migration
```

后端 SQL migration 统一放在
`apps/backend/services/<svc>/migrations/versions/`,文件名必须以
`vX.Y.Z` 开头。每个服务库都有 `migration` 表记录当前 schema 版本。
未传目标版本时,`just migrate-up <svc>` 会迁到本地最新 SQL 版本;传目标版本
时只执行 `(当前库版本, 目标版本]` 范围内的 SQL。

### overmind 进阶用法(装了之后)

```bash
just dev                       # 主终端
overmind connect svc-admin     # 另开终端,只看 admin 日志(可交互输入)
overmind restart mfe-admin     # 单独重启 admin remote
overmind kill                  # 全部干掉
```

---

## ✨ 开箱即用的能力

下面这些**不用你再做任何配置**,clone 下来跑起来就有:

### 工程基建

- ✅ **多语言 workspace 联动**:pnpm + uv + go.work 三套 workspace,改前端不触发后端重装,反之亦然
- ✅ **工具版本锁定**:`mise.toml` 一文件锁住 node/pnpm/python/uv/go/just,任何人/CI clone 下来 `mise install` 就是同一套环境
- ✅ **统一命令入口**:`justfile` 顶层 + 每个子 monorepo,`just <动词> [对象]` 一致语法,agent 不用猜命令
- ✅ **一条命令起全栈**:`just dev` 自动检测 overmind/mprocs/hivemind,没有则回退到纯 shell,Ctrl+C 干净退出
- ✅ **本地依赖一把起**:`docker compose up -d` 起 Postgres + Redis,带初始化脚本自动建多个 DB

### 跨栈协作

- ✅ **类型契约自动同步**:`just sync` 一条命令,后端 OpenAPI → 前端 TS 客户端;改后端 endpoint,前端 TS 编译期立刻报错或拿到新类型
- ✅ **内部 RPC 契约**:`schemas/proto/` + Buf,跨服务调用走类型安全的 gRPC,Python/Go 各自 codegen
- ✅ **异步事件契约**:`schemas/events/` 用 CloudEvents 1.0 标准,新事件加文件即生效
- ✅ **端口与 binding 漂移检查**:根 `services.yaml` 描述七个后端 deployable,`just lint` 对齐本地、Single-VPS 与 K8s

### 微服务 / 微前端伸缩

- ✅ **新建微服务先定边界**:`./scripts/new-service.sh <name>` 只生成最小骨架，再按 playbook 注册端口、binding、数据与部署面
- ✅ **新建 MFE 一键到位**:`./scripts/new-mfe.sh <name>` 生成 Rspack + MF 配置 + 路由占位
- ✅ **每个服务/MFE 独立 Dockerfile**:`apps/backend/services/<svc>/Dockerfile`,可独立部署
- ✅ **K8s 部署骨架就位**:`infra/k8s/base/<name>` + `overlays/{dev,prod}` Kustomize
- ✅ **服务自治边界已划清**:`services/<a>` 不能 import `services/<b>`、MFE 之间不能互相 import,跨边界只能走 `schemas/` 或 `libs/transport/`
- ✅ **平台共享层(MF shared)集中管理**:`@repo/build-config/mf-shared` 是唯一入口,host eager + remote lazy,新加 MFE 只装自己业务包(详见下文)

### CI / CD

- ✅ **路径过滤的 CI**:改前端只跑前端 workflow、改契约同时验证两端,见 `.github/workflows/{frontend,backend,contracts}.yml`
- ✅ **契约同步校验**:CI 强制 `just gen-openapi` + `git diff --exit-code`,schema 漂移直接红 PR
- ✅ **Buf lint + breaking detection**:gRPC 破坏性变更在 PR 阶段拦截

### Agent 协作能力

- ✅ **统一规则源**:`AGENTS.md`(根 + 各子目录 ~10 份),Claude/Codex/Cursor 都认,无 CLAUDE.md / .cursorrules
- ✅ **就近规则继承**:进入具体 service/app 后继续遵守最近一层 `AGENTS.md`
- ✅ **多 agent 协作基础设施**:`.agents/` 内置 playbooks(全栈需求 / 新服务 / 新 MFE / 跨服务重构)
- ✅ **专才 sub-agent 角色**:`codegen-runner` / `reviewer` / `explorer` 三类,主 agent 按需派发,主上下文不被污染
- ✅ **自我约束护栏**:`.agents/scopes/default.yaml` 主 agent 自带 forbidden / caution / free 三档清单
- ✅ **Worktree escape hatch**:`scripts/worktree.sh` 真并行场景下用,默认不需要

### 可观测 / 可维护

- ✅ **统一结构化日志**:Python `structlog` / Go `log/slog` / Node `pino`,全栈 stdout JSON 同一线格式;`trace_id` 经 `X-Trace-Id` 全链路串联(契约 `schemas/observability/logging.md`,ADR-0026)
- ✅ **统一错误处理**:`libs/kernel/errors.py` 提供 `RequestError/NotFoundError/...`,服务禁止裸 HTTPException
- ✅ **共享能力按消费者证据提取**:仅保留已有多消费者的 kernel / transport-ts；auth、审计、持久化不预建对称 SDK（ADR-0061）
- ✅ **OTel 接入点**:Python kernel 提供最小观测能力，其他 runtime 保持本地实现，统一字段而非强行共享代码
- ✅ **ADR 模板**:`docs/ADR/` 架构决策记录已就位,新决策走 PR 沉淀

---

## 🧩 平台共享层(Module Federation shared)

主应用(`platform`)是**运行时容器**,启动时把 React 生态 + 项目通用包**预装一份**到 share scope。
子应用(`admin` / `chat`)运行时复用 host 已经装好的副本,自己只下载业务代码与业务专属库。

### 当前共享清单

唯一入口:**`@repo/build-config/mf-shared`**(`apps/frontend/packages/build-config/mf-shared.mjs`;
用 `.mjs` 是因为 rspack-cli 用 Node 原生 ESM 加载 config,跨包导入 `.ts` 会报
`ERR_MODULE_NOT_FOUND`)。五层,host 提供 Tier1-3,remote 按需提供 Tier4-5:

| 层 | 包 | 用途 |
|---|---|---|
| Tier 1:框架级 | `react`、`react-dom`、`react-router` | React 18 生态,**必须 singleton** |
| Tier 2:平台基础设施 | `@repo/shared`、`@repo/runtime`、`@repo/observability` | 跨 MFE 运行时身份 |
| Tier 3:共享状态 | `zustand`、`@tanstack/react-query`、`sonner` | host 持有 context/全局发射器 |
| Tier 4:编辑器运行时 | `@tiptap/*`、`@tiptap/pm/*` | 编辑器状态与插件带运行时对象身份 |
| Tier 5:重型叶子库 | `@codemirror/*` | `singleton:false` 去重,由 remote 提供 |

**不进 shared 的**(各 app 按需装、各自 tree-shake):
- UI 能力包:`@repo/design-system`、`@repo/ai-elements`、`@repo/editors`、`@repo/viewers`
- 类型化 API client(`@repo/api` 统一导出,按需 import)

### 为什么 host 要 eager,remote 不要

- **host eager**:打进主 chunk,启动时**同步**注册到 share scope。后续 MFE 同步消费时拿得到 factory。
- **remote 不 eager**:被 host 加载时直接消费 host 的副本(零下载);standalone 跑 :3001 时通过自己 `main.tsx` 的 `import("./bootstrap")` 异步边界 init scope 后再用。

> 千万别同时 host + remote 都 eager,也别 host eager + 用异步边界——
> tree-shake 会把 react 摇出主 chunk,eager 失效,运行时报 `factory is undefined`。
> 故障排查段有详细 case。

### 加一个新的共享包

```text
1. packages/build-config/mf-shared.mjs:在对应 TIER 加一行
2. apps/platform/package.json:加 dep(若是 workspace 包用 "workspace:*")
3. 重启 just dev、浏览器硬刷新
```

只有真正需要**跨 MFE 共享同一份运行时身份**的包才进 shared——React context、
全局发射器、编辑器插件状态这类。纯展示型 UI 包放进去只会让所有 app 都被迫下载
它,反而丢掉 tree-shaking。

### 加一个新的 MFE

`./scripts/new-mfe.sh <name>` 已经把 `buildShared("remote")` 自动接上,
新 MFE 直接享受平台共享层,不用动 shared 配置。只在自己 package.json 里装业务专属库即可。

---

## 🛠️ 实操:加一个跨栈 demo 功能

示例：为 admin 增加一个配置查询能力。

```bash
# 1. 后端：在 admin 服务增加 route/application 逻辑
cd apps/backend/services/admin

# 2. lint + 导 OpenAPI
cd ../..
just lint admin
just gen-openapi admin

# 3. 同步契约(自动 codegen)
cd ..
just sync

# 4. 前端：在 admin remote 消费生成客户端
cd ../frontend/apps/admin
# 从 @repo/api 导入生成客户端或薄 wrapper

# 5. 根级验收
cd ../../../..
just check
just build
```

整个过程:
- ✅ 一个 agent 一直在工作,前后端上下文不丢失
- ✅ 类型从后端 → schemas → 前端,IDE 自动提示
- ✅ 改的文件都在隔离的子目录里,边界清晰

---

## 📂 仓库结构速览

```
monorepo/
├── AGENTS.md                  ← 给所有 AI agent 看的统一规则(先读这个)
├── README.md                  ← 你正在看的
├── justfile                   ← 顶层命令编排
├── Procfile.dev               ← `just dev` 的服务清单(overmind/mprocs/...)
├── mise.toml  docker-compose.yml
│
├── .agents/                   ← 多 agent 基础设施
│   ├── playbooks/             ←   主 agent 的工序 checklist
│   ├── subagents/             ←   专才 sub-agent(codegen / reviewer / explorer)
│   └── scopes/                ←   主 agent 自我约束护栏
│
├── apps/
│   ├── frontend/              ── 微前端 monorepo(pnpm)
│   │   ├── apps/platform/     ←   Module Federation Host
│   │   ├── apps/admin/        ←   管理与配置 Remote
│   │   ├── apps/chat/         ←   AI Chat Remote
│   │   └── packages/          ←   design-system / ai-elements / editors / viewers / api / ...
│   │
│   └── backend/               ── 微服务 monorepo(uv + go.work)
│       ├── services/admin/    ←   Python FastAPI 管理平面
│       ├── services/chat/     ←   TypeScript Agent runtime
│       ├── services/gateway/  ←   Go chi(BFF/网关)
│       └── libs/              ←   有 consumer 依据的薄共享能力
│
├── schemas/                   ← 跨栈契约(唯一允许的耦合点)
│   ├── openapi/               ←   各服务自动导出
│   ├── proto/                 ←   gRPC(Buf 管理)
│   └── events/                ←   异步事件(CloudEvents)
│
├── infra/k8s/                 ← Kustomize 部署清单
├── docs/                      ← ADR + 架构 + 规范 + 多 agent 协作
├── scripts/                   ← just recipes 的实现脚本 + README.md 索引
└── .github/workflows/         ← CI(path-filtered)
```

---

## 🐛 故障排查

### `just dev` 启动后 remote 一直加载

**原因**:admin 或 chat remote 仍在编译。`just dev` 会等待两个 manifest 再启动 platform；
如果手工单起 platform，需要自己保证 :3001 与 :3005 已就绪。

```bash
# 检查两个 remote 是否就绪
curl -s http://localhost:3001/mf-manifest.json | head
curl -s http://localhost:3005/mf-manifest.json | head

# 用 overmind 查看 remote 日志
overmind connect mfe-admin
overmind connect mfe-chat
```

### 浏览器报 `factory is undefined (webpack/sharing/consume/default/react/...)`

**原因**:Module Federation 的 share scope 在 consume-shared 触发时还没初始化。在 rspack +
`@module-federation/enhanced` 0.8 组合下最常见的原因是 **eager + tree-shaking + async-boundary 三者冲突**:
host 把 react 标 `eager: true` 想塞进主 chunk,但主入口 `import("./bootstrap")` 是异步的,
tree-shaker 看到入口没有静态引用 react,把 react 推进异步 vendor chunk,eager 就失效了。

本仓库当前的 host-remote 策略(已生效,后续新增 MFE 沿用即可):

- **platform(host)**:host 提供的共享项全部 `eager: true`,`main.tsx` **直接同步** `import { createRoot } from "react-dom/client"` + 渲染,**不要**用 `import("./bootstrap")` 异步边界,否则 tree-shake 会把 React 摇走。
- **admin / chat(remote)**:共享项 **不加** `eager`(federated 模式下消费 host 的 eager 副本;standalone 模式下靠自己 main.tsx 的 `import("./bootstrap")` 异步边界 init 自己的 scope)。

如果你看到这个报错,99% 是上面这两条规则被破坏了——检查 `platform/rspack.config.mjs`、`platform/src/main.tsx`、`admin|chat/rspack.config.mjs`、`admin|chat/src/main.tsx`。

### 启动后第一次访问 :3000 偶发报错 / 资源 404

**原因**:并行启动时 platform 比 remote MFE 先编译完,manifest 还没生成。

`just dev` 已在 Procfile / dev-shell 中加入 wait-for；platform 会等待 admin/chat
manifest。修改启动编排时必须保留这两个检查。

### 前端列表显示"请求失败"

**原因**:目标后端服务或 gateway 没起来。

```bash
# 应该都返回 200
curl -s http://localhost:8001/livez
curl -s http://localhost:8000/livez

# 用 overmind 看具体哪个服务出问题
overmind connect gateway
overmind connect svc-admin
```

### `pnpm install` 报错说找不到 `@module-federation/enhanced`

**原因**:`pnpm` 版本太旧或 node 版本不对。

```bash
node -v   # 应该是 v24.18.0
pnpm -v   # 应该是 11.9.0
mise install   # 重新装一遍
```

### `uv sync` 报错 "kernel" 解析不到

**原因**:不在 backend 工作区根跑,或 workspace 配置没生效。

```bash
cd apps/backend     # 必须在这里跑
uv sync --all-packages
```

### 端口被占用

固定端口分配(避免 agent 冲突):

| 服务 | 端口 |
|---|---|
| gateway | 8000 |
| gateway | 8000 |
| admin | 8001 |
| iam | 8002 |
| telemetry | 8008 |
| chat service | 8009 |
| knowledge | 8010 |
| executor | 8011 |
| platform | 3000 |
| admin remote | 3001 |
| chat remote | 3005 |

```bash
# 端口被占就杀
lsof -ti :3000 | xargs kill -9
```

### Docker 起不来 / Postgres 端口冲突

```bash
just down            # 关掉本仓库的 docker
docker ps            # 看是不是有别的项目占了 5432 / 6379
# 必要时改 docker-compose.yml 的 ports
```

---

## 🤖 给 AI agent 看的入口

1. 先读根目录 `AGENTS.md`(通用规则)
2. 进子目录后读那一层的 `AGENTS.md`(局部规则)
3. 跨栈做需求 → `.agents/playbooks/full-stack-feature.md`
4. 新建服务/MFE → `.agents/playbooks/new-{microservice,mfe}.md`
5. **不要**把前后端拆给两个 sub-agent —— sub-agent 各有独立 context window,
   你刚做的设计决策会丢。**单 agent 单上下文 + `cd` 切换**才是最快的姿势。

详见 `docs/多agent协作/index.md`。

---

## 📚 进一步阅读

| 想了解 | 看哪里 |
|---|---|
| 通用规则与边界 | `AGENTS.md` |
| 架构总览 | `docs/系统架构/overview.md` |
| 微服务规范 | `docs/微服务/index.md` + `apps/backend/AGENTS.md` |
| 微前端规范 | `docs/微前端/index.md` + `apps/frontend/AGENTS.md` |
| 多 agent 协作 | `docs/多agent协作/index.md` |
| 跨栈契约 | `schemas/AGENTS.md` |
| 架构决策 | `docs/ADR/` |

---

## ➕ 下一步可以扩展的点

- 加新微服务:`./scripts/new-service.sh reports`
- 加新微前端:`./scripts/new-mfe.sh reports`
- 生产迁移:沿用服务内 SQL migration 与 `migration.version` 版本指针
- 扩展 OTel：先按 ADR-0061 建 consumer matrix，再决定共享契约还是共享实现
- gRPC 服务间调用:补 `schemas/proto/<svc>/v1/*.proto`,`buf generate`
- 部署到 K8s:`infra/k8s/base/<svc>/` 已就位,改镜像 tag 即可

---

**Happy vibe coding.** 🎯
