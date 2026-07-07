# 系统架构总览

```
┌─────────────────────────────────────────────────┐
│                  Browser                        │
│  ┌────────────────────────────────────────┐     │
│  │  shell (host @ :3000)                  │     │
│  │   ├─ loads mfe-bot @ :3001             │     │
│  │   ├─ loads mfe-scene @ :3002 (TODO)    │     │
│  │   └─ ...                               │     │
│  └────────────────────────────────────────┘     │
└──────────────────┬──────────────────────────────┘
                   │ HTTP
                   ▼
┌──────────────────────────────────────────────────┐
│  gateway (Go @ :8000)                        │
│    - Authentication                              │
│    - X-Trace-Id propagation                      │
│    - Routing to internal services                │
│    - Aggregation (BFF)                           │
└──────┬─────────────┬─────────────┬───────────────┘
       │             │             │
       ▼             ▼             ▼
┌─────────┐    ┌─────────┐    ┌─────────┐
│ bot     │    │ scene   │    │ ...     │
│ :8001   │    │ :8003   │    │         │
│ Python  │    │ Python  │    │         │
└────┬────┘    └────┬────┘    └─────────┘
     │              │
     ▼              ▼
  ┌──────┐      ┌──────┐
  │ DB   │      │ DB   │   (each service owns its own)
  └──────┘      └──────┘
```

## 数据流

- **同步**: REST(对外)/ gRPC(服务间内部)
- **异步**: CloudEvents,经消息总线(Kafka,生产环境)

## 契约

唯一的跨栈/跨服务耦合点: `schemas/`
- `openapi/<svc>.json` — 各 Python 服务自动导出
- `proto/<svc>/v1/*.proto` — 手写,Buf 管理
- `events/*.cloudevents.json` — JSON Schema

## 部署

- 每个 service / MFE 独立 Docker 镜像
- K8s 部署清单在 `infra/k8s/base/<name>/`
- 环境覆盖在 `infra/k8s/overlays/{dev,staging,prod}/`
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
