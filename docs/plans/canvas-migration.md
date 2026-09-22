# AgentFrame Canvas 端到端接管计划

更新时间：2026-09-22
状态：已完成

## 目标与原则

- 核心业务以 `multix-app@1435719f6932b84172d077e67eefc2898c4c71aa` 和当前 `agentframe-web` 为事实源，高度还原项目、画布、节点、素材、生成、审核、故事板、归档及任务状态机。
- 外部依赖只使用 monorepo 的 IAM、Admin Provider/AIGW、Knowledge、Executor、chat-agent 和 OpenTelemetry。
- 只保留最终协议、最终数据模型和一套运行实现；不保留旧字段、fallback、双读写、shim、升级器或兼容 adapter。
- Canvas 数据无迁移义务，首次 migration 直接定义最终 PostgreSQL schema，开发环境清库重装。

## 最终架构

- Canvas 的唯一业务实现位于 `internal/domain`、`internal/application` 和 `internal/infrastructure`，`cmd/server` 直接装配这一套实现。
- HTTP 层只负责 IAM/service-auth 上下文、snake_case OpenAPI DTO 与 application 用例映射，不重新实现 revision、状态机、幂等、节点 patch、任务生命周期或分页。
- 浏览器统一经 Gateway `/api/canvas-server`；Chat、Executor 等内部服务直连 Canvas 根路径并使用 service token。两类入口复用同一 handler。
- Canvas 右侧对话唯一 runtime 是 Chat 的 AI SDK v7 `ToolLoopAgent`。同一 tenant/workspace/user/project/canvas 原子获取或创建一个私有会话；Canvas 协作数据共享，Chat 与 memory 不共享。
- Canvas 图片、视频和文本生成保留 AgentFrame 状态机，经 Admin Provider/AIGW 与 Executor 执行，媒体字节由 Knowledge 管理。
- Trace 只使用 monorepo OpenTelemetry，传播 W3C trace context，并覆盖 HTTP、关键业务阶段和任务状态。
- 前端保留 AgentFrame Canvas Studio 的业务交互，使用 monorepo design-system；所有业务请求直接消费生成 OpenAPI client 和 snake_case DTO。

## 已完成事项

1. 接管 AgentFrame/Multix 的 Canvas 领域规则、应用服务、PostgreSQL 持久层和异步任务状态机。
2. 删除 HiBot/Canvas 私有 Agent、私有配置、旧 tracing、旧协议 facade、数据升级器、读时修复与双实现。
3. 接入 IAM 项目权限、Admin Provider/模型/权益、Knowledge 对象存储、Executor workflow、chat-agent 和 OTel。
4. 建立最终 Canvas `v1.0.0` 与 Chat `v2.11.0` 空库 schema，包括 Canvas 私有会话唯一约束。
5. 对齐项目、Canvas、节点、资源、素材、生成、审核、故事板、归档、分页和统计的 OpenAPI 契约并重新生成跨栈客户端。
6. 将请求解码改为严格模式：未知字段、缺失必填字段和非法枚举直接返回 400，不推断旧数据语义。
7. 完成 Gateway 身份头清理、可信 service token、512 MiB 上传链路和部署配置。

## 验收结果

- 空库重装成功，Canvas 与 Chat 最终 schema 已在真实 PostgreSQL 中创建。
- 真实 Gateway HTTP 链路已验证：IAM 登录、项目创建、Canvas 创建、文本节点创建、图读取、资源统计、归档分页、Chat 会话唯一性、旧配置路由消失、删除 Canvas 后聊天历史只读。
- 严格协议已验证：旧节点 `name`、缺失 `reference_type`、非法 `reference_type` 均返回 400；最终节点协议返回 200。
- `just sync`、`just lint`、`just build`、Canvas `go test ./...`、`go vet ./...` 和前端 typecheck 均通过。
- 本地未配置真实付费 Provider，因此不把付费图片、视频、文本的成功产物作为本地环境验收条件；其调度、失败收敛和状态持久化均走最终依赖链。

## 完成判定

- 运行时只有一套 Canvas 领域、应用、持久化和 HTTP 协议。
- 跨栈契约只来自 `schemas/openapi/canvas-server.json` 及生成客户端。
- 不存在旧协议容忍、兼容 export、数据回填、运行时推断或替代 runtime。
- 基础设施差异只存在于明确的 monorepo dependency ports，不改变 AgentFrame 核心业务语义。
