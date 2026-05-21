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
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc && source ~/.zshrc
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

`just install` 帮你做了:
- 脚本可执行权限、`mise install`
- `pnpm install`(前端)、`uv sync`(后端 Python)、Go services `go mod tidy`
- 从 `.env.example` 复制缺失的 `.env`

`just up` 帮你做了:
- `docker compose up -d`(MySQL 8 + Redis)、建库、admin schema/种子数据

跑完之后浏览器打开 **http://localhost:3000**,就能看到完整跨栈链路:

```
浏览器 :3000
  └─ shell 通过 Module Federation 加载 mfe_bot/App
       └─ mfe-bot 调 fetch http://localhost:8000/v1/bots
            └─ api-gateway 反向代理到 http://localhost:8001/v1/bots
                 └─ bot 服务返回 3 个 demo Bot
```

| 服务 | URL | 角色 |
|---|---|---|
| shell | http://localhost:3000 | 微前端 host(主壳) |
| mfe-bot | http://localhost:3001 | 微前端 remote(智能体模块) |
| gateway | http://localhost:8000 | Go API 网关 |
| bot | http://localhost:8001/docs | FastAPI 智能体服务(Swagger UI) |

> 不想装 mise?自己装齐 `node@22 / pnpm@9 / python@3.12 / uv / go@1.23 / just / docker / jq` 也行。
> 不想装 overmind?`just dev` 会自动回退到纯 shell 模式,功能一样,只是日志混在一起。

---

## ⚡ 日常三条命令

> 装好之后,你每天写代码只需要这三条:

```bash
just install # 首次 clone:装齐 mise/pnpm/uv/go 与所有 workspace 依赖
just up      # 起 Docker + 建库 + schema
just dev     # 起全套服务(platform + mfe-admin + gateway + svc-admin),Ctrl+C 全停
just down    # 收工,关 docker
```

---

## 🧰 技术栈速览

- **前端**:React 18 + TypeScript + Rspack + **Module Federation 2.0**(`shell` host + `mfe-*` remote)
- **后端**:Python 3.12 + FastAPI(微服务) + Go 1.23 + chi(API Gateway)
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
| `just up` / `just down` | 起 / 关 docker(MySQL + Redis) |
| `just install` | 装所有依赖(前端 + 后端 Py + Go) |
| `just build` | **全栈构建**(前端 dist + Go 二进制) |
| `just build <target>` | 单目标构建:`shell` / `mfe-bot` / `api-gateway` / `frontend` / `backend` |
| `just build-images [registry] [tag]` | 后端所有服务打 docker 镜像 |
| `just sync` | 后端导出 OpenAPI → 前端重新生成 TS 客户端 ⭐ |
| `just fmt` | 一把梭格式化(ruff + prettier + gofmt) |
| `just lint` | 全栈 lint |
| `just test` | 全栈测试 |
| `just status` | git + PR 状态总览 |
| `just doctor` | 体检:工具 + docker 服务 |

子目录里有更细粒度的命令(只起一个服务、只测一个包):

```bash
# 前端
cd apps/frontend
just dev shell              # 单起 shell
just dev mfe-bot            # 单起 mfe-bot
just build                  # build 全部(turbo orchestrates)
just build shell            # 只 build shell → apps/shell/dist/
just build mfe-bot          # 只 build mfe-bot → apps/mfe-bot/dist/ + mf-manifest.json
just test mfe-bot           # 测 mfe-bot
just gen-client             # 重新生成 api-client

# 后端
cd apps/backend
just dev bot                # 单起 bot 服务
just dev api-gateway        # 单起 api-gateway
just build                  # Go 二进制 + 全部 docker 镜像
just build api-gateway      # 只 build Go 二进制 → services/api-gateway/bin/server
just build bot              # Python "build":lint + test + 导 OpenAPI 预检
just build-image bot        # docker build 单个服务 → local/bot:latest
just build-images           # 全部服务的 docker 镜像
just test bot               # 测 bot 服务
just gen-openapi bot        # 导出 OpenAPI 到 schemas/openapi/bot.json
just migrate-new bot "msg"  # 新建 alembic migration
just migrate-up bot         # 应用 migration
```

### overmind 进阶用法(装了之后)

```bash
just dev                       # 主终端
overmind connect bot           # 另开终端,只看 bot 日志(可交互输入)
overmind restart mfe-bot       # 单独重启某个服务
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
- ✅ **本地依赖一把起**:`docker compose up -d` 起 MySQL 8 + Redis,带初始化脚本自动建多个 DB

### 跨栈协作

- ✅ **类型契约自动同步**:`just sync` 一条命令,后端 OpenAPI → 前端 TS 客户端;改后端 endpoint,前端 TS 编译期立刻报错或拿到新类型
- ✅ **内部 RPC 契约**:`schemas/proto/` + Buf,跨服务调用走类型安全的 gRPC,Python/Go 各自 codegen
- ✅ **异步事件契约**:`schemas/events/` 用 CloudEvents 1.0 标准,新事件加文件即生效
- ✅ **端口冲突防护**:`justfile` 里固化端口表(前端 3000-3005、后端 8000-8007),多个 agent / dev server 并行不撞车

### 微服务 / 微前端伸缩

- ✅ **新建微服务一键到位**:`./scripts/new-service.sh <name>` 生成完整骨架(pyproject、main、routes、test、AGENTS.md)
- ✅ **新建 MFE 一键到位**:`./scripts/new-mfe.sh mfe-<name>` 生成 Rspack + MF 配置 + 路由占位
- ✅ **每个服务/MFE 独立 Dockerfile**:`apps/backend/services/<svc>/Dockerfile`,可独立部署
- ✅ **K8s 部署骨架就位**:`infra/k8s/base/<name>` + `overlays/{dev,staging,prod}` Kustomize,加新服务复制目录即可
- ✅ **服务自治边界已划清**:`services/<a>` 不能 import `services/<b>`、MFE 之间不能互相 import,跨边界只能走 `schemas/` 或 `libs/transport/`
- ✅ **平台共享层(MF shared)集中管理**:`apps/frontend/mf-shared.mjs` 是唯一入口,host eager + remote lazy,新加 MFE 只装自己业务包(详见下文)

### CI / CD

- ✅ **路径过滤的 CI**:改前端只跑前端 workflow、改契约同时验证两端,见 `.github/workflows/{frontend,backend,contracts}.yml`
- ✅ **契约同步校验**:CI 强制 `just gen-openapi` + `git diff --exit-code`,schema 漂移直接红 PR
- ✅ **Buf lint + breaking detection**:gRPC 破坏性变更在 PR 阶段拦截

### Agent 协作能力

- ✅ **统一规则源**:`AGENTS.md`(根 + 各子目录 ~10 份),Claude/Codex/Cursor 都认,无 CLAUDE.md / .cursorrules
- ✅ **就近规则继承**:进 `apps/backend/services/bot/` 自动只读到该服务的局部规则
- ✅ **多 agent 协作基础设施**:`.agents/` 内置 playbooks(全栈需求 / 新服务 / 新 MFE / 跨服务重构)
- ✅ **专才 sub-agent 角色**:`codegen-runner` / `reviewer` / `explorer` 三类,主 agent 按需派发,主上下文不被污染
- ✅ **自我约束护栏**:`.agents/scopes/default.yaml` 主 agent 自带 forbidden / caution / free 三档清单
- ✅ **Worktree escape hatch**:`scripts/worktree.sh` 真并行场景下用,默认不需要

### 可观测 / 可维护

- ✅ **结构化日志骨架**:Python 用 stdlib logging,Go 用 slog,JSON 输出统一
- ✅ **统一错误处理**:`libs/kernel/errors.py` 提供 `RequestError/NotFoundError/...`,服务禁止裸 HTTPException
- ✅ **审计 SDK**:`libs/audit_sdk` 提供 `record(...)`,关键变更动作统一记录
- ✅ **OTel 接入点**:`libs/observability/setup()`,后续接 Jaeger/Tempo/OTLP 改一处即可
- ✅ **ADR 模板**:`docs/ADR/` 架构决策记录已就位,新决策走 PR 沉淀

### 测试

- ✅ **后端 pytest 骨架**:bot 服务带 demo 测试 + TestClient,`uv run pytest -q` 即跑
- ✅ **前端 Vitest 骨架**:每个 package/MFE 都有 `test` 脚本
- ✅ **Go test 骨架**:api-gateway 带 handler 单测
- ✅ **scoped 测试**:`just test bot`、`just test mfe-bot` 各自跑,agent 改一个不必跑全量

---

## 🧩 平台共享层(Module Federation shared)

主应用(`shell`)是**运行时容器**,启动时把 React 生态 + 项目通用包**预装一份**到 share scope。
子应用(`mfe-*`)运行时**复用** host 已经装好的副本,自己只需要下载业务代码 + 业务专属库
(`react-markdown`、`monaco-editor` 之类)。

### 当前共享清单

唯一入口:**`apps/frontend/mf-shared.mjs`**(用 `.mjs` 是因为 rspack-cli 用 Node 原生 ESM 加载 config,跨包导入 `.ts` 会报 `ERR_MODULE_NOT_FOUND`;`.mjs` 是唯一通吃的扩展名)。两层:

| 层 | 包 | 用途 | 在 host(shell) | 在 remote(mfe-*) |
|---|---|---|---|---|
| Tier 1:框架级 | `react`、`react-dom`、`react-router-dom` | React 18 生态,**必须 singleton** | `eager: true` | `eager: false` |
| Tier 2:平台基础设施 | `@packages/shared`、`@packages/runtime`、`@packages/auth-client` | 项目内通用 workspace 包 | `eager: true` | `eager: false` |

**不进 shared 的**(各 MFE 自带):
- 服务粒度的 client(`@packages/api-client/bot`、`@packages/api-client/scene` ...,只有少数 MFE 用)
- MFE 业务专属 UX 库(`react-markdown`、`monaco-editor`、图表库...)

### 为什么 host 要 eager,remote 不要

- **host eager**:打进主 chunk,启动时**同步**注册到 share scope。后续 MFE 同步消费时拿得到 factory。
- **remote 不 eager**:被 host 加载时直接消费 host 的副本(零下载);standalone 跑 :3001 时通过自己 `main.tsx` 的 `import("./bootstrap")` 异步边界 init scope 后再用。

> 千万别同时 host + remote 都 eager,也别 host eager + 用异步边界——
> tree-shake 会把 react 摇出主 chunk,eager 失效,运行时报 `factory is undefined`。
> 故障排查段有详细 case。

### 加一个新的共享包

```text
1. apps/frontend/mf-shared.mjs:在 TIER1 / TIER2 加一行
2. apps/frontend/apps/shell/src/mf-eager-anchors.ts:加 side-effect import
3. apps/frontend/apps/shell/package.json:加 dep(若是 workspace 包用 "workspace:*")
4. 重启 just dev、浏览器硬刷新
```

第 2 步是关键——shell 的 src 没静态引用的 dep,会被 rspack tree-shake 摇走,
`eager: true` 就成了空头支票。anchor 文件用 `import * as _ from "..."` + `void _`
让 tree-shaker 没办法证明它没用。

### 加一个新的 MFE

`./scripts/new-mfe.sh mfe-<name>` 已经把 `buildShared("remote")` 自动接上,
新 MFE 直接享受平台共享层,不用动 `shared` 配置。只在自己 package.json 里装业务专属库即可。

---

## 🛠️ 实操:加一个跨栈 demo 功能

体验单 agent 跨栈干活的丝滑流程。假设要加"批量发布智能体":

```bash
# 1. 后端:在 bot 服务加新路由
cd apps/backend/services/bot
# (编辑 src/bot/routes/bots.py 加 POST /v1/bots:batch-publish)

# 2. 测试 + 导 OpenAPI
cd ../..
just test bot
just gen-openapi bot

# 3. 同步契约(自动 codegen)
cd ..
just sync

# 4. 前端:在 mfe-bot 加按钮
cd apps/frontend/apps/mfe-bot
# (编辑 src/App.tsx,从 @packages/api-client/bot import 新方法)

# 5. 测试
cd ../..
just test mfe-bot
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
│   │   ├── apps/shell/        ←   Module Federation Host(主壳)
│   │   ├── apps/mfe-bot/      ←   Module Federation Remote(智能体模块)
│   │   └── packages/          ←   components / runtime / shared / api-client / ...
│   │
│   └── backend/               ── 微服务 monorepo(uv + go.work)
│       ├── services/bot/      ←   Python FastAPI(智能体服务)
│       ├── services/api-gateway/ ← Go chi(BFF/网关)
│       └── libs/              ←   薄共享内核(kernel/transport/auth_sdk/...)
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

### `just dev` 启动后浏览器报 "Loading mfe_bot" 一直转

**原因**:mfe-bot 还在编译。`just dev` 已经会让 shell 等 mfe-bot 的 manifest ready 再启,
但如果你直接 `cd apps/frontend/apps/shell && pnpm dev` 单起 shell,就要自己保证 :3001 已就绪。

```bash
# 检查 mfe-bot 是否就绪
curl -s http://localhost:3001/mf-manifest.json | head

# 用 overmind 单独看 mfe-bot 日志
overmind connect mfe-bot
```

### 浏览器报 `factory is undefined (webpack/sharing/consume/default/react/...)`

**原因**:Module Federation 的 share scope 在 consume-shared 触发时还没初始化。在 rspack +
`@module-federation/enhanced` 0.8 组合下最常见的原因是 **eager + tree-shaking + async-boundary 三者冲突**:
host 把 react 标 `eager: true` 想塞进主 chunk,但主入口 `import("./bootstrap")` 是异步的,
tree-shaker 看到入口没有静态引用 react,把 react 推进异步 vendor chunk,eager 就失效了。

本仓库当前的 host-remote 策略(已生效,后续新增 MFE 沿用即可):

- **shell(host)**:`shared` 三个全部 `eager: true`,`main.tsx` **直接同步** `import { createRoot } from "react-dom/client"` + 渲染,**不要**用 `import("./bootstrap")` 异步边界,否则 tree-shake 会把 React 摇走。
- **mfe-bot(remote)**:`shared` **不加** `eager`(它在 federated 模式下消费 host 的 eager 副本;standalone 模式下靠自己 main.tsx 的 `import("./bootstrap")` 异步边界 init 自己的 scope)。

如果你看到这个报错,99% 是上面这两条规则被破坏了——检查 `shell/rspack.config.ts`、`shell/src/main.tsx`、`mfe-bot/rspack.config.ts`、`mfe-bot/src/main.tsx`。

### 启动后第一次访问 :3000 偶发报错 / 资源 404

**原因**:并行启动时 shell 比 mfe-bot 先编译完,manifest 还没生成。

`just dev` 已经在 Procfile / dev-shell 里加了 wait-for —— shell 进程会调
`scripts/wait-for-url.sh http://localhost:3001/mf-manifest.json` 阻塞,
直到 mfe-bot 的 dev server 起来再启动 shell。如果你改过 Procfile 顺序导致这个保护被破坏,恢复它。

### 前端列表显示"请求失败"

**原因**:后端 bot 服务或 api-gateway 没起来。

```bash
# 应该都返回 200
curl -s http://localhost:8001/healthz
curl -s http://localhost:8000/healthz
curl -s http://localhost:8000/v1/bots | jq

# 用 overmind 看具体哪个服务出问题
overmind connect gateway
overmind connect bot
```

### `pnpm install` 报错说找不到 `@module-federation/enhanced`

**原因**:`pnpm` 版本太旧或 node 版本不对。

```bash
node -v   # 应该 ≥ 22
pnpm -v   # 应该 ≥ 9
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
| api-gateway | 8000 |
| bot | 8001 |
| (预留) identity / scene / intention / ... | 8002-8007 |
| shell | 3000 |
| mfe-bot | 3001 |
| (预留) mfe-scene / mfe-intention / ... | 3002-3005 |

```bash
# 端口被占就杀
lsof -ti :3000 | xargs kill -9
```

### Docker 起不来 / MySQL 端口冲突

```bash
just down            # 关掉本仓库的 docker
docker ps            # 看是不是有别的项目占了 3306 / 6379
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

- 加新微服务:`./scripts/new-service.sh identity`
- 加新微前端:`./scripts/new-mfe.sh mfe-scene`
- 生产迁移:在 `admin` 服务用 alembic 管理 schema(本地 dev 仍用 `create_all` + seed)
- 接入 OTel:扩 `libs/observability/`,在 `main.py` 调 `setup("bot")`
- gRPC 服务间调用:补 `schemas/proto/<svc>/v1/*.proto`,`buf generate`
- 部署到 K8s:`infra/k8s/base/<svc>/` 已就位,改镜像 tag 即可

---

**Happy vibe coding.** 🎯
