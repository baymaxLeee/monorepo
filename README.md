# Project Monorepo

React/Rspack 微前端与 Python、TypeScript、Go 微服务组成的 AI 产品仓库。
当前架构、业务所有权与决策从 [docs/index.md](docs/index.md) 进入；
AI 开发规则从 [AGENTS.md](AGENTS.md) 进入。

## 本地启动

先安装 mise 和 Docker，然后从仓库根目录执行：

```bash
mise install
just install
just up
just dev
```

浏览器入口是 http://localhost:3000 。`just dev-urls` 列出开发地址；
`just doctor` 检查环境。`just up` 包含观测基础设施，`just up-core`
只启动核心依赖。`just down` 停止基础设施。

`just install` 安装 workspace 依赖并初始化本地样例；运行配置与凭据要求见
[部署文档](infra/single-vps/README.md)。数据库通过不可变版本化 SQL 保留数据升级；
单服务使用 `just migrate-up canvas`，全栈 `just up` 会应用所有待执行迁移。
升级、回退与数据转换见 [数据库迁移规范](docs/开发规范/database-migrations.md)。

## 定位与验证

```bash
just repo-map
just context frontend/@repo/chat
just context apps/backend/services/chat/src/application/agent
just test-list
just test-affected HEAD all --list
just test tooling
```

导航从实际 manifests 发现 owner、声明依赖和消费者。`repo-map` 与 `context`
支持 `--json`。源码依赖图不代替服务 binding 或真实 runtime 检查。

| 命令 | 用途 |
|---|---|
| `just dev` / `just dev-shell` | 组合开发环境 |
| `just build [target]` | 全量或指定 app/service/stack 构建 |
| `just sync` | 从源生成契约与客户端 |
| `just test <target> [args...]` | 原生 runner，前端包保留 `@repo/` |
| `just test-affected [base] [scope] [--list]` | 包含本地编辑的影响分析 |
| `just check-repo` | 依赖边界与文档导航 |
| `just lint` | 静态检查、类型与既有边界门禁 |
| `just check` | lint、测试与生成契约检查 |
| `just fmt` | 必要时执行格式化 |
| `just new-service <name>` / `just new-mfe <name>` | 按 playbook 创建组件 |

构建目标与测试目标不是同一套参数语法。测试目标以 `just test-list` 为准，
例如 `backend/chat`、`frontend/chat`、`frontend/@repo/chat`。
详细语义见[测试规范](docs/开发规范/testing.md)。

## 目录与事实源

| 目录/文件 | 职责 |
|---|---|
| `apps/frontend/apps` | Platform host 与 Admin/Chat/Canvas remotes |
| `apps/frontend/packages` | UI、feature、API、runtime 等公共能力 |
| `apps/backend/services` | 自有数据库、运行时和部署边界的服务 |
| `apps/backend/libs` | 有消费者依据的基础设施能力 |
| `services.yaml` | 后端组合、binding、端口与数据库 |
| `schemas` | 跨服务/跨栈契约与生成器 |
| `infra` | Compose、Single-VPS、K8s 部署 |
| `scripts` | just CLI 实现与回归测试 |
| `.agents` | 按需 skill、playbook 与临时任务状态 |
| `docs/ADR` | 按主题原地维护的当前架构决策 |

应用不导入另一应用，服务不访问另一服务源码/数据库。Platform 和 Gateway
分别拥有浏览器入口与 API 边缘；Chat 拥有交互 Agent，Executor 拥有耐久执行，
Knowledge 拥有文件语义，Asset 拥有物理 bytes。

## 故障定位

先运行 `just doctor`、`just dev-preflight`，再检查具体进程日志和 health。
remote 的端口提供 federation 资源，业务页面通过 Platform 路由打开。
共享单例、路由和 CSS 问题见[前端规则](apps/frontend/AGENTS.md)；
服务身份、数据库与启动问题见[后端规则](apps/backend/AGENTS.md)。

当前规范变化时覆盖对应章节；旧 ADR、旧实现与旧文档由 Git 历史追溯。
不再按年代逐篇加载决策来推断今天的系统。
