# ADR-0038: ClickHouse + OpenTelemetry 单机观测底座

## Status

Accepted (pending live trace verification)

## Context

现有系统已有两类观测数据：

- `chat.agent_runs` / `agent_steps` / tool call trace：面向用户和产品调试的 agent 生命周期记录。
- `telemetry` PostgreSQL 表：前端 RUM 错误与性能事件。

缺口是开发者侧的跨服务分布式 trace：一次 `chat` POST SSE 从 gateway 进入后，经过 chat agent model step、tool call、knowledge / executor 下游调用，无法在同一条标准 trace 中下钻。后续还需要承接系统性能观测、错误观测和 LLM token / 成本 / 延迟观测。

部署约束是单 VPS（4C4G40G）和 demo 阶段。直接自托管完整 Langfuse v3 全栈会引入 web、worker、Postgres、Redis、ClickHouse、对象存储等组件，资源压力和运维面都超过当前机器余量。

## Decision

观测 infra 一步到位选择 **ClickHouse + OpenTelemetry Collector**：

- 单 VPS prod compose 增加 ClickHouse 和 OTel Collector；本地 dev compose 放在
  `observability` profile 下，默认 `just up` 保持轻量，`just up-observability`
  才拉起 ClickHouse/Collector。
- Go gateway、Python FastAPI 服务、TS chat / executor 各自接入本语言 OTel SDK。
- 继续保留 `X-Trace-Id` 作为日志相关 ID，同时新增并传播 W3C `traceparent`。
- chat agent 的 model step 与 tool call 写入 OTel span，携带 run id、step number、tool name、token usage、耗时、错误摘要。
- telemetry 服务新增 `/ops/observability` 只读接口，供 admin ops 页展示 ClickHouse/OTel 状态。

组件一步到位，数据策略分阶段：

- 第一版 100% 记录 trace span、错误摘要、token usage、成本估算、首 token / 总耗时等结构化字段。
- 不逐条记录 SSE token chunk。
- 不默认把完整 prompt / response 正文写入 ClickHouse。
- ClickHouse 表使用 OTel exporter schema 与 7 天 TTL；logs 更短，metrics 后续以聚合为主。
- ClickHouse 容器硬限制为 1200MB，Collector 硬限制为 256MB；ClickHouse
  服务端总内存比例为 0.35，mark cache 降到 128MB。

## Consequences

收益：

- 避免先上轻量后端后期再迁移到 ClickHouse。
- Gateway → chat → knowledge / executor 的生命周期可用标准 `traceparent` 串起来。
- 后续可在同一数据面上接 Phoenix / Langfuse / Laminar 等 LLM 观测 UI，而不重做埋点。

代价：

- 4GB 内存下 ClickHouse 必须低资源配置：限制 query/merge 并发、mark cache、system log 表和 collector batch 队列。
- 40GB 磁盘必须保留 20%-25% 空闲并依赖 TTL，不能长期保留明细。
- 若要完整 Langfuse v3 自托管、保存长 prompt/response 或保留 30 天以上明细，机器应升级到至少 4C8G100G。

验收信号：

- 一次 `/api/chat-server/...` POST SSE 请求能在 ClickHouse `otel_traces` 中看到 gateway、chat、agent model step、tool call 和下游服务 span。
- 响应与日志继续包含 `X-Trace-Id`，同时响应和下游请求包含 `traceparent`。
- Admin `/platform/admin/observability` 能展示 ClickHouse 健康、近一小时 span 数和 OTel 能力状态。
