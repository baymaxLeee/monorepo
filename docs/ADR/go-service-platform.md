# 当前决策：Go 服务平台与 AI-native 基线

状态：当前。范围：`apps/backend` 内的 Go 服务、Go 基础设施库及仓库工具。
依赖和工具的精确版本以 `go-platform.json`、`go.mod`、`go.work`、`mise.toml` 与生成
recipe 为事实源；`go-platform.json` 是仓库 policy catalog，不改变 Go module 解析语义。

## 决策

Go 采用多 module workspace，不合并为一个根 `go.mod`。每个可部署服务继续拥有独立
`go.mod`、镜像、测试和发布边界；`go.work` 只声明本仓库参与开发的 module、统一 Go
language/toolchain，并允许本地 module 互相解析。仓库门禁要求：

- 所有 workspace module 使用同一个精确 `toolchain`；
- 同一个直接依赖在不同 module 中只能出现一个版本；
- 每个 module 在 `GOWORK=off` 下 `go mod tidy -diff` 仍然成立；
- Docker builder、`mise.toml` 与 workspace toolchain 一致；
- 直接三方依赖只选发布为 stable 的最新版本，不采用 alpha、beta、RC 或伪版本；
  Go toolchain 解析出的间接依赖不在应用 module 中手工改写。

Go 没有 `pnpm-workspace.yaml` catalog 的原生等价物。`go.work` 不拥有依赖版本，Go
module 也不支持从中央变量继承 `require`；版本仍写在各 module 的 `go.mod`，由 Minimal
Version Selection 解析。把版本一致性做成可执行仓库 policy，比用 `replace` 伪造中央
依赖目录更符合 module 自治；`replace` 只用于 workspace 内部 module 的独立构建。

## 统一技术栈

| 能力 | 当前选择 | 约束 |
|---|---|---|
| HTTP | `Gin` + `httpserver-go` | handler 与 middleware 统一使用原生 Gin API；只用 `gin.New`，不使用 `gin.Default` 或兼容 adapter |
| 外部契约 | OpenAPI 3.1 artifact + 固定版本 codegen | 生成 wire types/server/client；Chat 的透明 streaming proxy 保持显式实现 |
| 内部 RPC | Proto + gRPC | 生成类型；统一 caller identity、deadline、取消和 OTel stats handler |
| PostgreSQL | `pgx/v5` + `sqlc` | `pgx` 是 driver/transaction primitive；静态 SQL 默认由 `sqlc` 生成 typed repository |
| 动态 SQL | 局部原生 `pgx` | 只有 query shape 真正动态或 sqlc 无法表达时允许，并需要测试证明边界 |
| 配置 | `caarlos0/env/v11` | typed struct、启动期验证、非法配置 fail fast |
| 观测 | `log/slog` + OpenTelemetry | 共享 trace bootstrap；HTTP/gRPC 自动传播，业务 span/attribute 由服务拥有 |
| Redis | `redis/go-redis/v9` | 只在真实 consumer 引入，不建立第二套 client |
| 结构化日志 | 标准库 `log/slog` | 不使用 Zap、Logrus、Zerolog 或 service-local logging framework |
| ID | contract 已定格式保持；新无序 ID 默认 `google/uuid` UUIDv7 | ID 格式属于 contract，不由 ORM/model tag 隐式决定 |
| 并发 | `context`、标准 channel、`x/sync/errgroup` | goroutine 必须有 owner、cancel 与 wait，不允许 fire-and-forget |
| 测试 | 标准 `testing` + race detector；需要真实边界时用 Testcontainers | mock 不替代 SQL、事务、协议和取消语义验证 |

Admin、Canvas、Chat、IAM、Storage 和 Telemetry 各自拥有 PostgreSQL 迁移、命名 SQL 和生成的 Go 类型。
评审者和 Agent 可以从 SQL 查到参数、结果、作用域约束与锁，从 Go 调用点查到事务边界。
修改查询后在仓库根目录执行 `just gen-sql <service>`。Node.js 与 Python 服务继续按语言使用各自的持久化工具。

同一约束适用于全部通用能力：相似职责不得因服务作者偏好而并存多套三方库。完整的
按需矩阵和目录模板在 [Go 微服务模板](../开发规范/go-services.md)。领域专用 SDK 允许只在
真实 consumer 引入，但不得重新实现 router、config、logging、persistence、observability、
contract 或 concurrency 等已有平台能力。

### HTTP 边界

所有 Go HTTP 服务从共享 `httpserver-go.New(serviceName)` 创建 Gin engine，固定执行
`trace context → route params → OpenTelemetry → access log → recovery`。服务不得复制 trace ID、
访问日志或 panic recovery；服务专属鉴权、限流等 middleware 直接实现 `gin.HandlerFunc`。
共享层只接受并规范 W3C `traceparent`，并同步返回 `traceparent`，
日志记录稳定 route template、状态码、响应大小、耗时和 trace ID。response 已写出（尤其是
SSE）后发生 panic 时只终止并记录，不向流尾追加 JSON 错误体。

Gin 只占有 transport/router 边界，路由参数从 `gin.Context` 显式读取后传给 application；
application/domain 不导入 Gin。OpenAPI Go server binding 统一生成 `gin-server`，禁止保留
Chi binding、`net/http` handler/middleware adapter 或在 Gin 外再包一层 server tracing handler。

## AI-native 原则

“AI-native”描述系统可被模型与 Agent 正确理解、生成、验证和观测的程度，不等于优先
采用名字带 AI 的新库。基础设施选择顺序是：官方协议/SDK、Go-native typed API、可重复
codegen、显式取消与 streaming、可观测性，最后才是 framework convenience。

- schema、SQL、Proto、OpenAPI 和 tool schema 是一等事实源；生成输出不可手改；
- 请求、stream、tool call、durable job 都传播 context、deadline、取消、trace 和稳定 ID；
- mutation 明确幂等键、事务和 retry ownership，不能让通用 SDK 隐式重试；
- Agent/tool 边界优先采用官方 MCP Go SDK；模型供应商优先采用官方 SDK；
- Eino、Genkit 等编排库只在某个 Go 服务真正拥有 model/tool/graph runtime 时引入，且先用
  当前 stable 版本做最小 vertical slice。不能为了“新兴”把 repository、HTTP 或 lifecycle
  绑进 AI framework；当前 Runtime 仍由 TypeScript AI SDK 负责，不在 Go 服务复制编排核心。

## 升级与验证

依赖升级是一项仓库级变更：先查询上游 stable release，再一次性更新所有 workspace
consumer，执行 `go work sync`，随后运行 `just check-go-modules`、受影响 race tests、build
及根 lint。工具版本必须固定在 recipe 中，禁止 `@latest` 进入 CI 或生成命令；“最新 stable”
通过显式升级变更实现，而不是让构建结果随日期漂移。

本轮基线按 2026-11-27 的 upstream stable release 选定：Go 1.27.4、Gin 1.12.0、pgx
5.13.0、sqlc 1.31.1、caarlos0/env 11.4.2、OpenTelemetry 1.47.0/otelgin 0.72.0、
oapi-codegen 2.8.2。精确生效值仍以 manifest 为准，文档日期不构成长期锁定理由。

主要证据：Go 的 [workspace 教程](https://go.dev/doc/tutorial/workspaces) 与
[module reference](https://go.dev/ref/mod)、[sqlc 配置](https://docs.sqlc.dev/en/latest/reference/config.html)、
[OpenAI 的 PostgreSQL 扩展实践](https://openai.com/index/scaling-postgresql/)、
[Google Cloud 的 pgxpool 建议](https://docs.cloud.google.com/go/docs/reference/cloud.google.com/go/cloudsqlconn/latest)、
[OpenTelemetry Go instrumentation](https://opentelemetry.io/docs/languages/go/instrumentation/)、
[Gin 官方文档](https://gin-gonic.com/en/docs/) 与
[oapi-codegen Gin server 文档](https://github.com/oapi-codegen/oapi-codegen#generating-server-side-boilerplate)、
[MCP 官方 SDK 列表](https://modelcontextprotocol.io/docs/sdk) 及
[Eino 官方说明](https://github.com/cloudwego/eino/blob/main/llms.txt)。

## 取舍

多 module 会重复少量 `require` 行，但保留独立构建与发布能力；门禁承担版本一致性。
sqlc 增加生成步骤，却把 SQL 评审、schema 漂移和类型错误提前到构建期。显式 bootstrap
比大型 framework 多一些 wiring，但 lifecycle、失败清理和 service ownership 更可见，
也更容易被测试和 Agent 安全修改。
