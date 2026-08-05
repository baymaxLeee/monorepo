# 微服务

服务组合与 binding 的架构决策见 [ADR-0060](../ADR/0060-service-composition-and-bindings.md)。
机器可读真源：仓库根目录 `services.yaml`（`just lint` 会跑 drift check）。

## 现有服务

| 服务 | 语言 | 端口 | 公开面 | 数据所有权 | 出站 binding | 说明 |
|---|---|---|---|---|---|---|
| gateway | Go | 8000 | `/*`（唯一后端公网入口） | 无业务库 | iam, admin, chat, knowledge, telemetry | 边缘反向代理 BFF |
| iam | Go | 8002 | `/api/iam-server/*` | PostgreSQL `iam` | — | 身份 / 会话 |
| admin | Python | 8001 | `/api/admin-server/*` | PostgreSQL `admin` | — | 管理与配置平面 |
| chat | TypeScript | 8009 | `/api/chat-server/*` | PostgreSQL `chat` | admin, knowledge, executor | 对话 / Agent runtime |
| knowledge | Python | 8010 | `/api/knowledge-server/*` | PostgreSQL `knowledge` | admin | 知识库 / ingest / artifact |
| telemetry | Python | 8008 | `/api/telemetry-server/*` | PostgreSQL `telemetry` | — | 可观测 / RUM |
| executor | TypeScript | 8011 | **internal-only**（无公网 route） | PostgreSQL `executor` (+ `workflow`) | admin, knowledge | 长任务 durable executor |

Failure 责任（摘要）：同步 HTTP binding 的 timeout / 错误映射由 **caller 的 transport client** 负责；gateway 不对 proxied/SSE 请求做 body 重试。长任务重试与跨请求状态在 executor / Workflow，不藏在普通 HTTP handler。

## 通用规则

参见 `apps/backend/AGENTS.md`。核心约束:
- 服务自治: 各自的 DB、各自的部署、不互相 import
- 跨服务调用: 显式 binding + `libs/transport-*` 或服务内 client，不走直接 import
- 共享内核(`libs/`): 只放有 consumer matrix 依据的基础设施,**禁止**放领域模型（见 ADR-0061）
- 参照边界: next-forge → 前端 package；Vercel Services → 组合/routing/binding；Eve **仅** agent runtime，不是微服务注册模板

## 服务内统一分层

服务是业务与部署边界，服务内部统一按技术职责分层（ADR-0045）：

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
内部独立，例如 `api/http/routes/bots.py`、`application/bots.py` 和
`infrastructure/persistence/repositories/bots.py`。

只有业务不变量、值对象、策略和确定性状态转换可以进入 `domain/`。domain
不得依赖 api、application、infrastructure、ORM、HTTP 框架或运行时 SDK；仅有
CRUD/DTO 的服务不创建占位 domain。

## 数据库迁移

- 每个服务的 SQL migration 放在
  `apps/backend/services/<svc>/migrations/versions/`。
- 文件名必须是纯版本号,例如 `v1.0.0.sql`。不要添加描述后缀。
- 每个服务库必须有 `migration` 表,只保留 `id = 1` 一行,记录当前库
  schema 版本。
- `just up` 会扫描所有服务的 migrations 并调用 `scripts/db-migrate.sh`。
- 执行范围是 `(当前库 migration.version, 目标版本]`。
- 未传目标版本时,目标版本默认为该服务本地 SQL 目录里的最新版本。
- 服务启动时禁止自动建表; schema 只能由 migration 管理。

## Gateway

- 服务目录和服务名统一为 `gateway`。
- gateway 负责路由、认证边界、CORS、结构化请求日志、反向代理、边缘限流
  和 trace 传播。
- 日志相关 ID 继续使用 `X-Trace-Id`; 不使用 `X-Request-Id`。标准分布式
  trace 使用 W3C `traceparent`，gateway 生成或透传后写回响应并继续传给
  下游服务。
- 单 VPS 观测底座为 ClickHouse + OpenTelemetry Collector（ADR-0038）。
  第一版 trace 优先、7 天 TTL，不逐条保存 SSE token chunk，不默认保存完整
  prompt / response 正文。

## 添加新服务

参见 `.agents/playbooks/new-microservice.md`。

## 服务间通信

- **同步**: gRPC(优先,定义在 `schemas/proto/`)或 REST(`schemas/openapi/`)
- **异步**: CloudEvents(`schemas/events/`)

### 内部 API (`/internal/*`)

部分服务对**同集群 sibling 服务**额外暴露 `/internal/*` 路径
(例如 `admin` 的 `/internal/providers/*`)。约定:

- gateway **不**代理 `/internal/*` 到公网 —— 仅集群内可达。
- 调用方在 header 携带 `X-Internal-Token`,由被调方用 `hmac.compare_digest`
  校验值与本地 `INTERNAL_API_TOKEN` 一致。
- 业务身份(目标用户)通过 query 参数 `user_id=<uid>` 显式传递,由调用方
  在公开入口完成鉴权后再发起内部调用。
- 内部响应可包含**解密后**的敏感字段(API key 等),公开 API **绝不**
  返回相同形态 —— 必须脱敏(参考 `admin.services.encryption.mask`)。

典型场景: `chat` 在每次发消息时调
`admin:/internal/providers/default?user_id=<uid>` 取一份解密后的
provider snapshot,本地内存 TTL 缓存 5 分钟以避免每次流式
chunk 都打 sibling。

文档与 artifact 由 `knowledge` 持久化; `chat` 通过
`knowledge:/internal/documents/*` 读取上下文并写入 artifact。

## 服务文档

- [chat](./chat.md)
- [knowledge](./knowledge.md)
- [executor](./executor.md)
