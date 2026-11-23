# Chat

Chat 是 Web 产品边界，不是 Agent Runtime。它保留产品 conversation 元数据、用户可见标题、
Canvas/Project 绑定，以及 product conversation 到 Runtime Session 的映射；messages、Turn、run
journal、工具、文件执行、Sandbox 和 detached durable Job 都由 [Runtime](runtime.md) 持有。

## 模块结构

Chat 沿用后端服务的模块聚合规范，但每层只保留产品层职责：

- `cmd/server/`、`cmd/openapi/`：服务与 OpenAPI 导出入口；
- `internal/api/http/`：浏览器-facing `/conversations` 路由、请求校验、Gateway scope 鉴权与统一错误边界；
- `internal/application/`：产品 conversation 用例编排、Runtime Session 映射、响应投影与代理授权；
- `internal/bootstrap/`：配置、依赖装配、健康检查与进程生命周期；
- `internal/infrastructure/`：Chat PostgreSQL repository 与 Runtime HTTP client。

HTTP route 不直接访问 PostgreSQL 或拼装 Runtime workload identity；application 负责用例顺序，
infrastructure 负责数据库与内部 HTTP adapter。Chat 变薄只减少业务所有权，不取消原有 server
的 composition root、错误处理、健康检查和模块边界。

禁止在 Chat 中重新引入模型、`ToolLoopAgent`、run lease、Redis stream、Sandbox controller 或
Workflow。Chat 的执行类路由校验 product conversation scope 后，以 `X-Caller-Service: chat`
调用 Runtime `/v1/sessions`，把模型、Media、plugin、Skill 与 Memory 解析为冻结的 tenant-neutral
Turn capability，并透明转发响应流和取消信号。proxy adapter 不向 Runtime 转发任何 `X-Auth-*`；
它只透传 `Content-Type`、`traceparent`、`tracestate` 与 `X-Trace-Id`，并始终覆盖调用方传入的
`X-Caller-Service`、`X-Internal-Token`，避免浏览器输入伪造 workload identity。

## 数据与 API

Chat PostgreSQL 只保存 `conversations` 产品表和 `runtime_session_id` 映射。当前 fresh baseline
为 `v1.0.0.0`，不包含 messages、runs、files 或 durable tasks。

- `POST /conversations`：先创建 Runtime Session，再写入 product mapping；
- `GET/PATCH/DELETE /conversations/{id}`：先按用户、tenant、workspace 校验本地映射，再读取或修改 Runtime Session；
- `/conversations/{id}/*` 执行路由：把 product id 映射为 Runtime Session id 后流式代理；
- `/memories/*`：由 Chat 保存 tenant/workspace/user-scoped 产品 Memory，并在 Turn 开始时投影为冻结内容；
- `/local-inference/*`：保留 Web wire surface，Chat 完成业务授权与 provider/plugin capability 解析，Desktop Runtime 只消费 tenant-neutral 结果。

Chat 对外保留 `/conversations` 契约；Runtime 内部契约使用 `/v1/sessions`。边界、生命周期和三角色
部署见 [Session Runtime ADR](../ADR/session-runtime.md)。

验证：`just test backend/chat`、`just lint chat`、`just build chat`、`just sync` 和 `just check-repo`。
