# 微服务

服务组合与 binding 的架构决策见 [docs/ADR/architecture.md](../ADR/architecture.md)。
机器可读真源：仓库根目录 `services.yaml`（`just lint` 会跑 drift check）。

## 现有服务

| 服务 | 语言 | 端口 | 公开面 | 数据所有权 | 出站 binding | 说明 |
|---|---|---|---|---|---|---|
| gateway | Go | 8000 | `/*`（唯一后端公网入口） | 无业务库 | iam, admin, storage, chat, canvas, knowledge, telemetry | 边缘反向代理 BFF |
| iam | Go | 8002 | `/api/iam-server/*` | PostgreSQL `iam` | — | 身份 / 会话 |
| admin | Go | 8001 | `/api/admin-server/*` | PostgreSQL `admin` | storage | 管理与配置平面 |
| chat | Go | 8009 | `/api/chat-server/*` | PostgreSQL `chat` | runtime | Web Chat 产品会话与呈现投影 |
| [runtime](runtime.md) | TypeScript | 8015（server）/ 8011（worker）/ 8014（sandbox） | **internal-only** | PostgreSQL `runtime` + Workflow `workflow` | admin, knowledge, storage | Session/messages、ToolLoopAgent、Sandbox 与 durable Job |
| canvas | Go | 8012 | `/api/canvas-server/*` | PostgreSQL `canvas` | admin, storage | 项目 / 画布 / 素材 |
| knowledge | Python | 8010 | `/api/knowledge-server/*` | PostgreSQL `knowledge` | admin, storage | 知识库 / ingest / RAG |
| telemetry | Go | 8008 | `/api/telemetry-server/*` | PostgreSQL `telemetry` | — | 可观测 / RUM |
| storage | Go | 8013 | `/api/storage-server/*` | PostgreSQL `storage` + 独占 byte volume | — | 统一 Asset revision / Claim / delivery / GC 控制面 |

Failure 责任（摘要）：同步 HTTP binding 的 timeout / 错误映射由 **caller 的 transport client** 负责；gateway 不对 proxied/SSE 请求做 body 重试。长任务重试与跨请求状态在 Runtime worker / Workflow，不藏在普通 HTTP handler。

## 通用规则

参见 `apps/backend/AGENTS.md`。核心约束:
- 服务自治: 各自的 DB、各自的部署、不互相 import
- 跨服务调用: 显式 binding + 生成的 `libs/transport-*` 或服务内 client，不走直接 import；业务层不直接操作原始 HTTP，详见 [内部 API 传输决策](../ADR/inner-api-transport.md)
- 共享内核(`libs/`): 只放有 consumer matrix 依据的基础设施,**禁止**放领域模型（见 docs/ADR/architecture.md）
- 参照边界: next-forge → 前端 package；Vercel Services → 组合/routing/binding；Eve **仅** agent runtime，不是微服务注册模板

## 服务内统一分层

服务是业务与部署边界，服务内部统一按技术职责分层（docs/ADR/architecture.md）：

```text
bootstrap/       启动、配置、依赖装配与生命周期
api/             HTTP/gRPC 入站适配器与 middleware
application/     应用用例、业务流程编排与输入输出 contracts
domain/          与框架无关的实体、规则、错误与事件（按需创建）
infrastructure/  持久化、外部 client、provider、缓存、安全与可观测实现
```

主依赖方向为 `api -> application`；application 可使用 domain 规则与同服务的
infrastructure 适配器，只有外部边界或多实现确有需要时才引入 port。`bootstrap`
负责最终装配。ORM model
属于 `infrastructure/persistence/models`，不是 domain entity。资源继续在每层
内部独立，例如 `api/http/providers.go`、`application/providers.go` 和
`infrastructure/persistence/providers.go`。

只有业务不变量、值对象、策略和确定性状态转换可以进入 `domain/`。domain
不得依赖 api、application、infrastructure、ORM、HTTP 框架或运行时 SDK；仅有
CRUD/DTO 的服务不创建占位 domain。

## 数据库迁移

服务独占自己的版本化 SQL，已执行文件不可修改。开发与部署均保留已有数据，
通过 `just migrate-up <service>` 或部署的 `db-init` 执行待应用版本。
升级、应用回退、schema 修复、数据回填与备份恢复的唯一流程见
[数据库迁移规范](../开发规范/database-migrations.md)。

## Gateway

- 服务目录和服务名统一为 `gateway`。
- gateway 负责路由、认证边界、CORS、结构化请求日志、反向代理、边缘限流
  和 trace 传播。
- 日志相关 ID 继续使用 `X-Trace-Id`; 不使用 `X-Request-Id`。标准分布式
  trace 使用 W3C `traceparent`，gateway 生成或透传后写回响应并继续传给
  下游服务。
- 单 VPS 观测底座为 ClickHouse + OpenTelemetry Collector（docs/ADR/operations.md）。
  第一版 trace 优先、7 天 TTL，不逐条保存 SSE token chunk，不默认保存完整
  prompt / response 正文。

## 添加新服务

参见 `.agents/playbooks/new-microservice.md`。

## 服务间通信

- **当前同步调用**：声明 binding 的 Proto/gRPC transport，契约在 `schemas/proto/`；`just sync` 为 Go、TypeScript、Python 生成 wire binding。
- **耐久任务通知**：Runtime worker 的 Workflow-backed 内部 SSE；Chat 使用原生 UIMessage 流。
- CloudEvents 保留异步契约目录，不表示已经部署通用消息 broker。

### 内部 RPC

Admin、Knowledge、Canvas 与 Storage 对同集群 sibling 暴露标准 gRPC 服务。约定：

- gateway 不代理 RPC 端口到公网；Single-VPS 和本地使用 h2c，不要求 sidecar。
- 生成 client 自动携带固定 caller metadata、trace、deadline 和取消；接收方按 method allowlist 校验 caller。
- 当前 h2c client 使用 insecure transport credentials；caller metadata 是网络隔离内的命名空间声明，
  不是密码学 workload 认证。部署必须限制 RPC 端口可达面，服务端 allowlist 仍不能防止获准 sibling
  伪造另一 caller。它不得替代最终用户或资源级授权。
- 普通业务 owner 按具体契约携带 tenant/workspace/user，由调用方从认证上下文取得；
  接收方继续校验资源 scope，不能只凭 caller token 或 user_id 授权。Runtime 是执行层例外：产品宿主
  先完成这些业务授权，再传递冻结的 tenant-neutral capability；Runtime 不接收或保存业务身份字段。
- Storage 是刻意的例外：其 Proto 与数据库不携带业务身份，以 deployment-allowlisted `x-caller-service` 划分
  workload 命名空间，并以 caller-scoped exact-revision Claim 授权内部读取和 capability 签发。
  tenant/workspace/user 授权留在资源所属服务；
  对公网的上传和读取只能使用短期签名 capability，不能把裸资源 ID 当权限。
- RPC 响应可包含**解密后**的敏感字段(API key 等),公开 API **绝不**
  返回相同形态 —— 必须脱敏（参考 Admin `internal/infrastructure/crypto.Mask`）。

典型场景：Chat 通过 Admin RPC 按当前业务 scope 解析 provider/plugin/skill/media，并把冻结的
tenant-neutral capability 传给 Runtime；Runtime 不凭 Session 反查 Admin 作用域。
具体路由、缓存与刷新策略以 client 和 owner 契约为准，不把旧 TTL 写成平台规则。

文档语义、解析和检索由 `knowledge` 持久化；文件 bytes 由 `storage` 统一保存。
业务服务只持久化 `asset_id + revision_id`，并在本地事务写 Claim intent。

## 服务文档

- [iam](./iam.md)
- [admin](./admin.md)
- [canvas](./canvas.md)
- [storage](./storage.md)
- [chat](./chat.md)
- [knowledge](./knowledge.md)
- [runtime](./runtime.md)
- [Runtime Sandbox 运行规范](./sandbox.md)
