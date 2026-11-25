# 当前系统架构

Web 请求从 Platform 经过 Gateway 进入产品服务。以对话为例，Chat 校验会话权限，
将产品 conversation 映射到云端 Runtime Session，代理消息流和取消请求。桌面本地
执行由 Electron utility process 承载，与云端共用 Runtime 内核。

| 查什么 | 事实源 |
|---|---|
| 谁拥有资源、授权和持久状态 | [业务资源与所有权](../领域模型/index.md) |
| 服务有哪些出站依赖、使用 HTTP 还是 RPC、持有哪些数据库 | [服务清单](../../services.yaml) |
| 哪些内部接口使用 gRPC、哪些保留 HTTP、SSE 或 MCP | [内部 API 传输决策](../ADR/inner-api-transport.md) |
| 云与本地如何运行 Turn，如何从 journal 恢复 | [Session Runtime](../ADR/session-runtime.md) |
| 浏览器断开后如何恢复进行中的消息流 | [活跃流恢复](../ADR/chat-stream-resumption.md) |

## 架构决策入口

- [服务与代码边界](../ADR/architecture.md)：分层、共享、事务和显式 binding。
- [Agent 与上下文](../ADR/agent-runtime.md)：一个 ToolLoopAgent、原生 UIMessage、
  权限/审批、压缩与可变权威引用。
- [耐久执行](../ADR/durable-execution.md)：Workflow、内部 task SSE 与取消补偿。
- [文件与媒体](../ADR/files-and-assets.md)：业务语义和物理 bytes 分离。
- [身份与配置](../ADR/identity-and-configuration.md)：认证 scope 与配置所有者。
- [前端](../ADR/frontend.md)：MFE、公共能力包、host 路由与设计系统。
- [运行部署](../ADR/operations.md)：Postgres、密钥、ClickHouse/OTel。
- [工程与文档](../ADR/engineering.md)：可查询上下文、依赖验证和当前快照。

## 事实与验证

[schemas](../../schemas/AGENTS.md)拥有线协议；源码和测试确认当前行为。
[根 AGENTS](../../AGENTS.md)路由工作，`just context <path-or-target>` 定位 owner。
当前实现与本文不一致时追踪契约并修正文档或缺陷，不从旧计划推断实现。
