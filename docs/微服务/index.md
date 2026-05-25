# 微服务

## 现有服务

| 服务 | 语言 | 端口 | 说明 |
|---|---|---|---|
| gateway | Go | 8000 | BFF / 边缘网关 |
| admin | Python | 8001 | 智能体管理 |

## 通用规则

参见 `apps/backend/AGENTS.md`。核心约束:
- 服务自治: 各自的 DB、各自的部署、不互相 import
- 跨服务调用: 走 `libs/transport/` 客户端,不走直接 import
- 共享内核(`libs/`): 只放基础设施,**禁止**放领域模型

## 数据库迁移

- 每个服务的 SQL migration 放在
  `apps/backend/services/<svc>/migrations/versions/`。
- 文件名必须以 `vX.Y.Z` 开头,例如 `v1.0.0.sql` 或
  `v1.1.0__add_index.sql`。
- 每个服务库必须有 `migration` 表,只保留 `id = 1` 一行,记录当前库
  schema 版本。
- `just up` 会扫描所有服务的 migrations 并调用 `scripts/db-migrate.sh`。
- 执行范围是 `(当前库 migration.version, 目标版本]`。
- 未传目标版本时,目标版本默认为该服务本地 SQL 目录里的最新版本。
- 服务启动时禁止自动建表; schema 只能由 migration 管理。

## Gateway

- 服务目录和服务名统一为 `gateway`。
- gateway 负责路由、认证边界、CORS、结构化请求日志、反向代理和 trace
  传播。
- 统一 trace header 为 `X-Trace-Id`; 不使用 `X-Request-Id`。
- gateway 生成或透传 `X-Trace-Id`,写回响应 header,继续传给下游服务,
  并在日志中记录为 `trace_id`。

## 添加新服务

参见 `.agents/playbooks/new-microservice.md`。

## 服务间通信

- **同步**: gRPC(优先,定义在 `schemas/proto/`)或 REST(`schemas/openapi/`)
- **异步**: CloudEvents(`schemas/events/`)
