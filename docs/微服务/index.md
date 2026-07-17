# 微服务

## 现有服务

| 服务 | 语言 | 端口 | 说明 |
|---|---|---|---|
| gateway | Go | 8000 | BFF / 边缘网关 |
| admin | Python | 8001 | 智能体管理 |
| iam | Go | 8002 | 身份认证 / 会话 |
| telemetry | Python | 8008 | 可观测 / RUM 上报 |
| chat | TypeScript | 8009 | 对话 / Agent runtime（SSE 流式） |
| knowledge | Python | 8010 | 知识库 / 文件 ingest / artifact 持久化 |
| executor | TypeScript | 8011 | 长任务 durable executor（Workflow DevKit） |

## 通用规则

参见 `apps/backend/AGENTS.md`。核心约束:
- 服务自治: 各自的 DB、各自的部署、不互相 import
- 跨服务调用: 走 `libs/transport/` 客户端,不走直接 import
- 共享内核(`libs/`): 只放基础设施,**禁止**放领域模型

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
