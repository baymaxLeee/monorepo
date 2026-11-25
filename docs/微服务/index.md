# 微服务

查服务端口、数据库、公开路径与出站协议，读取 [services.yaml](../../services.yaml) 对应服务项。
查业务归属，读取[领域模型](../领域模型/index.md)。修改服务前运行 `just context apps/backend/services/<service>` 获取目录规则和测试入口。

## 开发入口

- [后端规则](../../apps/backend/AGENTS.md)与[服务分层决策](../ADR/architecture.md)定义依赖方向和装配边界。
- [内部 API 传输决策](../ADR/inner-api-transport.md)说明 RPC、HTTP、SSE 与 MCP 的适用边界和调用方身份。
- [数据库迁移规范](../开发规范/database-migrations.md)说明增量升级、回退和恢复流程。
- [新服务 playbook](../../.agents/playbooks/new-microservice.md)列出注册、部署与验证入口。

## Gateway

- 服务目录和服务名统一为 `gateway`。
- gateway 负责路由、认证边界、CORS、结构化请求日志、反向代理、边缘限流
  和 trace 传播。
- 日志相关 ID 继续使用 `X-Trace-Id`; 不使用 `X-Request-Id`。标准分布式
  trace 使用 W3C `traceparent`，gateway 生成或透传后写回响应并继续传给
  下游服务。
- 单 VPS 观测底座为 ClickHouse + OpenTelemetry Collector（docs/ADR/operations.md）。
  第一版 trace 优先、7 天 TTL，不逐条保存 SSE token chunk，不默认保存完整
  prompt / response 正文。

## 服务文档

- [iam](./iam.md)
- [admin](./admin.md)
- [canvas](./canvas.md)
- [storage](./storage.md)
- [chat](./chat.md)
- [knowledge](./knowledge.md)
- [runtime](./runtime.md)
- [Runtime Sandbox 运行规范](./sandbox.md)
