# 当前系统架构

```text
Browser → Platform → Admin / Chat / Canvas remotes
                  ↓ typed API / native streams
               Gateway
                  ↓ declared bindings + authenticated scope
       IAM · Admin · Chat · Canvas · Knowledge · Telemetry · Asset
                         ↘ Executor → Workflow Postgres World
```

Platform 是唯一用户入口，Gateway 是唯一公共 API 边缘；Executor 只通过内部
契约访问。服务组成、端口、binding 和数据库唯一清单是
[services.yaml](../../services.yaml)，不在总览维护第二份。

## 所有权

IAM 拥有身份与 tenant/workspace；Admin 拥有运营配置；Chat 拥有会话与交互
Agent；Canvas 拥有画布业务；Knowledge 拥有文档语义/虚拟文件；Asset 拥有
durable bytes、revision、Claim 和交付；Executor 拥有耐久执行；Telemetry
接收和查询观测数据。详细[业务词表](../领域模型/index.md)原地维护。

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

同步跨服务调用使用声明的 HTTP transport；已有 Proto/event schemas 只代表
契约面，不能据此声称部署了通用 gRPC 网络或消息 broker。Chat 的 Redis stream
负责 transport resume，Workflow 负责持久执行，服务数据库负责业务状态。

## 事实与验证

[schemas](../../schemas/AGENTS.md)拥有线协议；源码和测试确认当前行为。
[根 AGENTS](../../AGENTS.md)路由工作，`just context <path-or-target>` 定位 owner。
当前实现与本文不一致时追踪契约并修正文档或缺陷，不从旧计划推断实现。
