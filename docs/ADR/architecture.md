# 当前决策：服务与代码边界

状态：当前。维护方式：原地更新；旧版本从 Git 追溯。

## 架构

仓库是多语言、独立部署的产品组合。后端 deployable 在 `apps/backend/services/`，后端专用基础设施在 `apps/backend/libs/`；前端 deployable 在 `apps/frontend/apps/`，浏览器共享能力在 `apps/frontend/packages/`；跨栈 Node 能力在根 `packages/`。所有 JavaScript/TypeScript 项目使用根 `pnpm-workspace.yaml` 与单一 lockfile，Python 和 Go 保留各自原生 workspace，由根 just CLI 统一入口；不把业务服务合并成共享大内核。

[services.yaml](../../services.yaml) 是后端 runtime、端口、公开路径、binding、数据库和 OpenAPI 产物的唯一组合声明。公开业务服务必须声明可离线重建的 OpenAPI artifact；IAM 也属于该契约链，不再由前端复制身份 DTO。目录发现只能发现代码项目，不能推导服务权限或网络连接。`check-services.py` 验证本地与部署面一致，不生成第二套部署配置。

Gateway 是唯一公共 API 边缘，承担认证、CORS、限流、反向代理与 trace 传播，不承担业务聚合。
Runtime 三个角色都保持内部访问，浏览器只经 Chat 产品 API 进入 Runtime。Platform 是唯一浏览器业务入口，通过 Module Federation 加载 remote。独立部署不等于可以任意改变共享契约。

## 所有权与依赖

- 服务不导入其他服务源码、不读写其他服务数据库；使用声明的 HTTP binding 和 transport client。跨栈/跨服务契约由 [schemas](../../schemas/AGENTS.md) 管理；多语言同步调用的生成、认证、trace、deadline 与错误边界见 [内部 API 传输决策](inner-api-transport.md)。
- 应用是依赖图叶节点，其他 app/package 不依赖其源码；共享包通过公开 exports 消费。运行时协作通过 URL、事件或后端状态，不跨 app 读取私有 store。
- 共享实现需要真实多消费者，或必须集中处理的安全/协议原因。提取前列明消费者、需要和当前位置，选择共享实现、只共享契约或继续服务本地实现。
- `libs/` 不放领域模型；不为语言对称性创建 kernel/transport 包。认证、数据库事务和加密不得随普通工具函数一起抽进大内核。

服务内按 `bootstrap`、`api`、`application`、`domain`、`infrastructure` 分责。 `api -> application`，纯领域规则不依赖框架、ORM 或 SDK；CRUD 不建占位 domain。ORM 模型属于 infrastructure。各资源在路由、用例、契约、持久化层保持明确归属。

### 应用宿主与组合根

所有语言使用同一套逻辑边界，但保留语言惯用的文件、包和框架；统一的是职责、依赖方向与进程协议，
不是用一个跨语言 framework 统一语法。

| 边界 | 唯一职责 | 禁止 |
| --- | --- | --- |
| entrypoint | 创建进程级取消信号，调用一个 bootstrap 入口，记录终止错误并设置退出码 | 组装 repository/client/router，读取业务配置，启动后台任务 |
| `bootstrap` | 加载并校验配置，初始化 observability/adapters/use cases/router，管理 server/worker 生命周期与有序关闭 | 放业务规则、HTTP DTO、SQL 或 provider policy |
| `api` | transport 解码、校验、鉴权上下文、调用 application、编码协议错误 | 直接访问数据库或拼装外部 SDK/client |
| `application` | 一个用例内的业务编排、事务边界，以及由用例消费方定义的 ports | 导入 `api`、具体数据库/HTTP/Redis adapter 或进程 bootstrap |
| `domain` | 需要跨用例保护的纯业务不变量与状态转换；简单 CRUD 可以不存在 | 导入框架、ORM、网络、环境变量或进程状态 |
| `infrastructure` | 实现 application/domain ports：持久化、缓存、内部 HTTP、provider、telemetry adapter | 被 domain 反向依赖，或拥有业务流程顺序 |

依赖方向固定为 `api -> application -> domain`；`infrastructure` 向内实现 consumer-owned port；
`bootstrap` 是唯一可以同时看到 transport、application 与具体 adapters 的 composition root。
根 `just check-repo` 通过 `scripts/backend-architecture.mjs` 检查 Go import 方向与常驻进程入口；
`apps/backend/architecture-import-exceptions.json` 只登记尚未完成端口反转的精确旧依赖，并在依赖消失时因
stale exception 失败。它不是新代码的白名单：新增 exception 必须先完成同一变更内可行的 ports/adapters
整改，并记录剩余迁移边界。
服务内不再建立含义重叠的通用 `app` 层。复杂服务按业务 capability 在每层内继续分包，模块可以导出
自己的 `Module`/`Bindings` 装配函数，由 bootstrap 聚合；禁止把全部依赖继续堆进一个数百行 constructor，
也禁止引入运行时 service locator 或反射 DI 容器。

语言映射如下：Go 使用 `cmd/<role>` 与 `internal/{bootstrap,api,application,domain,infrastructure}`；
TypeScript 使用 `src/cmd/<role>` 与 `src/{bootstrap,api,application,domain,infrastructure}`；Python 使用
`src/main.py`（或多角色 `src/cmd/<role>.py`）与相同的 `src/{bootstrap,api,application,domain,infrastructure}`。
一次性 seed/backfill/migrate 是独立 role entrypoint，不伪装成 server 的位置参数。

所有常驻角色遵循同一进程协议：启动时一次性校验不可变配置；在有界 timeout 内建立必需依赖；
`livez` 只表达进程存活，`readyz` 在依赖未就绪或 drain 后停止接流量；HTTP server 和 worker 都监听
同一个取消上下文；关闭顺序为 stop admission/readiness → drain HTTP/worker → close adapters → flush telemetry。
后台 goroutine/task 的错误必须返回 bootstrap owner，禁止在子 goroutine 内 `os.Exit`。这些约束对应
[Go module layout](https://go.dev/doc/modules/layout)、[Go consumer-owned interfaces](https://go.dev/wiki/CodeReviewComments#interfaces)、
[hexagonal architecture ports/adapters](https://docs.aws.amazon.com/prescriptive-guidance/latest/hexagonal-architectures/best-practices.html)、
[Kubernetes probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/) 和
[OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/) 的公开实践。

事务由用例拥有；同一工作单元的读写使用同一事务，外部 HTTP/Workflow 启动不放进数据库事务。跨服务所有权变化通过持久 intent/outbox 与幂等接收方收敛，不模拟跨库事务。语言特定约束在[后端规则](../../apps/backend/AGENTS.md)及服务 AGENTS。

## 取舍与验证

这保留运行时和部署自治，代价是必须同步契约、绑定与部署入口。选择显式所有权而非目录自动注册、服务间源码共享或统一数据层，避免局部修改改变另一服务业务。

验证入口：`just check-repo`、`just lint`、受影响测试和构建；契约变化执行 `just sync`。结构变化还验证 install/dev/部署路径。业务所有权见[词表](../领域模型/index.md)，不在本文件复制服务清单。

## Sandbox 边界的共享判断

| 能力                  | 消费者                         | 选择                                               |
| --------------------- | ------------------------------ | -------------------------------------------------- |
| 沙箱生命周期/命令 API | Runtime server → sandbox role | OpenAPI 契约与 transport-ts client；不共享角色源码 |
| 原件流式读取 | Runtime server 的 sandbox bridge → Storage | 扩展既有 Storage transport client，沿用 scope 鉴权 |
| 进程监督/文件传输 | Runtime sandbox role | Runtime 私有，不抽取通用业务库 |

Runtime sandbox role 单独持有容器/Pod 控制权限，runtime-server 只持调用凭据，runtime-worker
无此权限。这隔开了模型/业务凭据与高权限执行控制面；部署与故障语义见 [Sandbox](../微服务/sandbox.md)。

## Agent harness 的共享判断

| 能力 | 真实消费者 | 决策 |
| --- | --- | --- |
| SDK 主循环、固定提示词组装、step 策略 | Runtime server、Electron utility host | 共享 `packages/agent-runtime` 实现，不维护本地专属循环 |
| Tool manifest、ToolOutcome、Bash 定义、审批策略 | 同上，结果由同一 Chat UI 消费 | 共享实现；环境只注入命令执行适配器，UI 不按执行位置分支 |
| IAM、模型凭据与转发 | Runtime 模型访问层、Electron relay transport | Runtime 解析服务端凭据，Electron 仅消费受限推理协议；不将身份/数据库抽进 harness |
| 工作区与消息持久化 | 云端 Storage/PostgreSQL、本地磁盘/SQLite | 各宿主负责 I/O 和清理，保留文件与会话；不复制 Agent 决策策略 |

共享包由根 pnpm workspace 管理；Runtime server 与 Electron 都通过声明的 `workspace:*` 依赖消费。包只依赖 SDK 和 schema 基础设施，不引用服务、Electron 或数据库；根 Turbo 边界把它标记为 runtime capability。
库的消费者必须通过声明依赖进入 affected checks 和镜像构建计划。
