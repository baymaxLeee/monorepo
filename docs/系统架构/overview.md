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

- Logs: 结构化 JSON(Python: stdlib logging, Go: slog)
- Traces: gateway 统一处理 `X-Trace-Id`,写回响应、透传下游,并在日志中使用
  `trace_id`; OpenTelemetry/W3C TraceContext 后续接入时从该边界扩展
- Metrics: Prometheus
