# 系统架构总览

```
┌─────────────────────────────────────────────────┐
│                  Browser                        │
│  ┌────────────────────────────────────────┐     │
│  │  platform (host @ :3000)               │     │
│  │   ├─ loads admin @ :3001               │     │
│  │   ├─ loads chat @ :3005                │     │
│  │   └─ ...                               │     │
│  └────────────────────────────────────────┘     │
└──────────────────┬──────────────────────────────┘
                   │ HTTP
                   ▼
┌──────────────────────────────────────────────────┐
│  gateway (Go @ :8000) — sole public API edge     │
│    - Authentication / X-Auth-*                   │
│    - X-Trace-Id + W3C traceparent                │
│    - Prefix reverse proxy (not business agg)     │
│    - Does not expose executor (internal-only)    │
└──────┬─────────────┬─────────────┬───────────────┘
       │             │             │
       ▼             ▼             ▼
┌─────────┐    ┌─────────┐    ┌─────────┐
│ admin   │    │ chat    │    │ ...     │
│ :8001   │    │ :8009   │    │         │
│ Python  │    │ Node.js │    │         │
└────┬────┘    └────┬────┘    └─────────┘
     │              │
     ▼              ▼
  ┌──────┐      ┌──────┐
  │ DB   │      │ DB   │   (each service owns its own)
  └──────┘      └──────┘
```

服务图真源：`services.yaml`（[ADR-0060](../ADR/0060-service-composition-and-bindings.md)）。
前端 package 边界：next-forge 风格 capability 拆分；Eve 不用于服务注册。

## 数据流

- **同步**: REST(对外)/ gRPC(服务间内部)
- **异步**: 长任务使用 Workflow DevKit + PostgreSQL 持久执行；Executor 任务状态通过
  Workflow 持久流向内部消费者通知。当前未部署通用 Kafka/RabbitMQ 事件总线。

## 契约

唯一的跨栈/跨服务耦合点: `schemas/`
- `openapi/<svc>.json` — 各 Python / Node 服务按声明自动导出
- `proto/<svc>/v1/*.proto` — 手写,Buf 管理
- `events/*.cloudevents.json` — JSON Schema

## 部署

- 每个 service / MFE 独立 Docker 镜像
- K8s 部署清单在 `infra/k8s/base/<name>/`
- 环境覆盖在 `infra/k8s/overlays/{dev,prod}/`
- CI 路径过滤,只构建受影响的部分

## 可观测性

- Logs: 全栈统一结构化 JSON(stdout / NDJSON),保留字段 `time`/`level`/`msg`/
  `service` + 可选 `trace_id`。各语言用原生结构化 logger——Python `structlog`、
  Go `log/slog`、Node `pino`——不引入 OTel SDK。契约见
  `schemas/observability/logging.md`(ADR-0026)
- Traces: `X-Trace-Id`(兼容 W3C `traceparent`)由 gateway 边缘生成/规范化,
  写回响应、透传下游;每个服务入站中间件把 `trace_id` 存入原生请求上下文,
  logger 自动注入每条日志,出站客户端回填头部,实现全链路串联。后续接
  OpenTelemetry Collector 时按契约字段表 transform,无需改服务代码
- Metrics: Prometheus
