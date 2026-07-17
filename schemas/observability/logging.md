# 结构化日志线格式契约(跨栈)

后端是 Go + Python + Node 混合技术栈。这份文档定义**所有服务共同遵守的日志行
格式**——就像 `openapi/` 和 `proto/` 一样,它是一份跨栈 wire contract,所以放在
`schemas/` 下。目标只有一个:无论日志来自哪种语言,落到 stdout 的每一行 JSON 都能
被同一套查询/聚合规则消费,并且能用 `trace_id` 把一次请求在多个服务里的日志串起来。

> 底座选型(见 `docs/ADR/0026-unified-structured-logging.md`):各语言用**原生
> 结构化 logger**——Go `log/slog`、Python `structlog`、Node `pino`——**不引入
> OpenTelemetry SDK**。字段命名对齐 OTel 日志语义约定,只是为了将来接
> OTel Collector 时能零改造 transform。

---

## 1. 日志行格式

- 输出目的地:**stdout**,一行一条 JSON(NDJSON)。不写文件、不做 rotation
  (交给容器/平台采集,12-factor)。
- 编码:UTF-8;不得输出多行 JSON 或 pretty-print。

### 保留字段(所有栈必须逐字一致,业务字段不得覆盖)

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `time` | string | 是 | RFC3339,毫秒精度,UTC,带 `Z`。例:`2026-07-05T05:36:00.123Z` |
| `level` | string | 是 | 小写枚举:`debug` \| `info` \| `warn` \| `error` |
| `msg` | string | 是 | 人类可读消息;稳定、低基数,变量放独立字段 |
| `service` | string | 是 | 服务标识:`gateway`/`iam`/`admin`/`knowledge`/`telemetry`/`chat`/`executor` |
| `trace_id` | string | 否 | 32 位小写 hex(W3C trace-id)。**没有就省略该键**,不要写空串 |
| `span_id` | string | 否 | 16 位小写 hex。当前轻量底座通常不产生 span,可缺省 |

### 业务上下文字段

传播上下文字段(`trace_id`、`user_id`,及预留的 `workspace_id`/`tenant_id`)由
logger 依 §3 的注册表**自动注入**,业务代码无需手动传入。其余业务字段一律平铺为
顶层键,用 `snake_case`,常见:`method`、`path`、`status`、`duration_ms`、
`conversation_id`、`run_id`、`task_id`、`err`。禁止再用保留字段名承载业务语义。

示例(一次 chat 请求的 access log):

```json
{"time":"2026-07-05T05:36:00.123Z","level":"info","msg":"http","service":"chat","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","method":"POST","path":"/conversations/abc/messages","status":200,"duration_ms":842}
```

---

## 2. 各 logger 的默认差异与对齐规则

三种 logger 默认键不同,实现时必须显式对齐到第 1 节的字段:

### Go — `log/slog`

- 默认已输出 `time`/`level`/`msg`;但 `level` 是大写(`INFO`)、`time` 带本地
  时区与纳秒。用 `HandlerOptions.ReplaceAttr` 把 `level` 转小写、把 `time`
  规范为 UTC 毫秒 `Z`。
- 用 `logger.With("service", "<name>")` 设为进程默认,保证每条都带 `service`。
- `trace_id` 由中间件从 `context` 取出后作为字段附加。

### Python — `structlog`

- 自定义 timestamp processor 产出**毫秒** UTC `time`(带 `Z`)——structlog 的
  `TimeStamper(fmt="iso")` 给的是微秒且 `+00:00`,会与 pino/slog 的毫秒 `Z` 不
  一致,故显式格式化;事件键默认是 `event`,用 `EventRenamer` **rename 为 `msg`**。
- `structlog.processors.add_log_level` 产出小写 `level`(符合契约)。
- 一个自定义 processor 从 `kernel.tracing.get_trace_id()` 注入 `trace_id`
  (为空则不加键);静态注入 `service`。
- 通过 `logging.config.dictConfig` + `structlog.stdlib.ProcessorFormatter`
  接管 stdlib root 与 `uvicorn`/`uvicorn.error`/`uvicorn.access`,使框架日志
  也走同一 JSON 渲染。

### Node — `pino`

- `timestamp: pino.stdTimeFunctions.isoTime` → `time`(ISO 毫秒);
  `formatters.level: (label) => ({ level: label })` → 小写字符串 level
  (pino 默认输出数字);消息键默认即 `msg`。
- `mixin` 从 `AsyncLocalStorage` 读取当前 `trace_id` 注入;`base: { service }`
  静态注入 `service`。

---

## 3. 关联上下文(correlation context)全链路传播

一次请求携带一组**低基数关联标识符**贯穿所有服务:它们既注入每条日志,也在
服务间调用时透传。规范头一律 `X-*`(禁止 `X-Request-Id`)。

### 传播字段注册表(唯一真相源)

| 字段 | wire header | 日志键 | 来源 / 语义 |
| --- | --- | --- | --- |
| trace_id | `X-Trace-Id`(兼容 `traceparent`) | `trace_id` | gateway 边缘生成/规范化(32-hex);纯链路关联 |
| user_id | `X-Auth-User-ID` | `user_id` | gateway 验证 JWT 后注入;身份凭证 |
| workspace_id | `X-Workspace-Id` | `workspace_id` | 预留;gateway 拿到数据时注入 |
| tenant_id | `X-Tenant-Id` | `tenant_id` | 预留;gateway 拿到数据时注入 |

这张表定义的是**日志关联上下文**,不是完整鉴权上下文。Gateway 仍按业务鉴权需要
传播 `X-Auth-Email`、`X-Auth-Name`、`X-Auth-Roles`、`X-Auth-Org-*` 等头;
logger 只自动注入低基数字段,避免把完整用户/profile 快照变成日志查询维度。

每栈把这张表实现为**一处注册表**(Go/Python/Node 各一份),中间件读、logger
注入、transport 透传都遍历它;**新增一个上下文字段 = 注册表加一行**,不改中间件
/logger/transport 的主体。

### 每个服务遵循同一模式

1. **入站**:HTTP 中间件按注册表读全部 header,存入语言原生请求上下文
   (Go `context`、Python `contextvar`、Node `AsyncLocalStorage`),回写 `X-Trace-Id`。
2. **日志注入**:logger 遍历注册表,把上下文里**存在**的字段注入每条日志(空则省略键)。
3. **出站(服务间)**:HTTP 客户端遍历注册表,把当前上下文的字段写回下游请求头,
   实现跨服务串联。Node 侧 `libs/transport-ts` 通过注入的 `propagatedHeaders` 回调
   (由 `libs/kernel-ts` 从当前上下文生成)拿到这批头。

### 身份注入的安全约束

`X-Auth-*` 及未来 `X-Workspace-Id`/`X-Tenant-Id` 都是**受信字段**:gateway 是
唯一入口,注入前先 `Del` 客户端可能伪造的同名头,只写从 JWT/授权来源解析出的值,
下游无条件信任。日志上下文只消费其中的低基数字段。

### executor 的特例(Workflow DevKit)

executor 的 `"use workflow"`/`"use step"` 运行在会持久化/重放的沙箱里:
`AsyncLocalStorage` **不跨 step 边界**,且沙箱禁止静态 import Node 依赖
(见 `services/executor/AGENTS.md`)。因此:

- HTTP 入口层(`app.ts`)用 `AsyncLocalStorage` + pino,与其他服务一致;
- workflow-imported clients 不 import `@backend/kernel-ts` 或
  `@backend/kernel-ts/trace`,避免 `node:async_hooks` 进入 orchestrator 依赖图;
- 跨 step 的 payload 级 `trace_id`/`user_id` 传播仍是 follow-up。当前
  workflow-internal 日志继续用 `console.*`,HTTP 边界日志已经具备 `trace_id`。

---

## 4. OTel 语义映射(仅备查,当前不实现)

将来接 OTel Collector 时,按下表做字段 transform 即可,无需改服务代码:

| 本契约字段 | OTel Logs Data Model |
| --- | --- |
| `time` | `Timestamp` |
| `level` | `SeverityText`(并派生 `SeverityNumber`) |
| `msg` | `Body` |
| `trace_id` | `TraceId` |
| `span_id` | `SpanId` |
| `service` | Resource `service.name` |
| 其余顶层键 | `Attributes.*` |

---

## 5. 实现位置索引

- Go:`services/{gateway,iam}/internal/api/http/middleware`(`TraceId` + `RequestLogger`)
  与各 `cmd/server/main.go` 的 slog 初始化。
- Python:`libs/kernel/src/kernel/logging.py`(`configure_logging` +
  `RequestLoggingMiddleware` + trace 注入 processor)、`kernel/tracing.py`。
- Node:`libs/kernel-ts`(`logger` + `traceContext` + `traceMiddleware` +
  `requestLogger`);`libs/transport-ts` 负责出站头注入。
