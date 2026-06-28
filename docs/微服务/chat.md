# chat service

对话 / Agent Runtime 微服务（**TypeScript**, Hono + Nitro + Vercel AI SDK +
Workflow DevKit + Drizzle）。
负责会话、消息与 agent runtime 事件流。文档与 artifact 由 **knowledge**
服务持久化；chat 是 knowledge 的**消费者**。

## Owner / 责任范围

- DB 表：`conversations`、`messages`、`agent_runs`、`agent_steps`、
  `agent_tool_calls`、`user_memories`（`conversation_documents` 已迁至 knowledge）
- HTTP API（gateway 暴露为 `/api/chat-server/conversations/*`）
  - `GET/POST /conversations` — 列表 / 新建
  - `GET/PATCH/DELETE /conversations/{id}` — 详情（含消息 + knowledge 文档列表）/ 更新 / 删除
  - `POST /conversations/{id}/agents/run/stream` — start WorkflowAgent run
  - `GET /conversations/{id}/agents/run/stream/{workflowRunId}/stream` — resume Workflow stream

## 不负责

- 用户身份（→ iam）
- 智能体 / LLM Provider 配置（→ admin）
- 文件上传、MarkItDown、artifact 存储（→ knowledge）
- 审计日志（→ audit，未来通过事件）

## LLM 上游

通过 `@backend/transport-ts` 的 admin internal client 调
`GET admin:/internal/providers/*?user_id=<uid>`；chat 本地
`src/clients/admin.ts` 只做 provider 快照缓存与错误映射。Vercel AI SDK +
OpenAI-compatible provider（`@ai-sdk/openai-compatible`）。

## 服务间调用

- chat → admin / knowledge 统一走 `apps/backend/libs/transport-ts`
  (`@backend/transport-ts`)。
- `src/clients/admin.ts` / `knowledge.ts` 是 chat facade，不直接拼 URL 或裸
  `fetch`。
- Workflow 内的跨服务 I/O 必须在 `'use step'` 函数里执行。

## Agent runtime

- Run 宿主：`@ai-sdk/workflow` `WorkflowAgent`，由 Nitro + `workflow/nitro` 构建。
- Stream resume：前端 `WorkflowChatTransport`，后端 Workflow readable stream。
- Workflow World：本地与部署均使用 `@workflow/world-postgres`；本地由
  `just up` 执行官方 `workflow-postgres-setup`，运行时通过
  `WORKFLOW_POSTGRES_URL` 连接固定的 PostgreSQL World 实现。

部署环境必须使用 `@workflow/world-postgres`。Compose 在 chat 前运行
`workflow-db-init`，Kubernetes 使用同镜像的 `workflow-schema`
initContainer；二者都执行官方 schema setup，失败时禁止 chat 启动。
- Version guard：`agent_runs.workflow_version` 与当前 `CHAT_WORKFLOW_VERSION` 不一致时拒绝 resume/cancel。
- 工具：`update_plan`、`list_documents`、`read_document`、`analyze_image`、`create_artifact`、`begin_artifact`、`write_artifact_part`、`publish_artifact`、`update_artifact`、`web_search`、`ask_user`、`propose_memory`
- `update_plan` 的 tool output 随 assistant message 持久化。下一轮提取最新 active
  snapshot 并注入主 Agent context，因此 completed todo 不会因刷新或裁剪丢失。
- Markdown 使用 `create_artifact`。HTML 由主 WorkflowAgent 先创建 plan，再调用
  `begin_artifact`、逐项 `write_artifact_part`，最后 `publish_artifact`。工具只负责
  持久化和确定性编译，不启动 child workflow，也不在工具内部调用模型。
- `update_artifact` 当前仍是旧全文 revision 路径；下一阶段切换到 block change set、
  局部生成和 `base_revision_id` CAS 后删除字符切片实现。
- HTML block 和 compiled revision 写入现有 ObjectStore；Workflow state、tool result
  和 SSE 均不携带完整正文，避免大型文档反复序列化。
- `create_artifact` 以 `toolCallId` 幂等创建；`update_artifact` 携带读取时的
  `updated_at` 做原子条件写。超过阈值的旧正文按有边界的片段修订，若生成期间
  artifact 已变化则返回冲突，不覆盖并发更新。
- 当前迁移阶段：durable model streaming / resume / cancel / server-side final persistence 已接入 Workflow；
  全部 workflow tools（含 `analyze_image`、`update_artifact`）已通过 `'use step'` 接入；
  artifact 生成过程中的逐 token 预览仍是后续 parity 工作。

## 入口文件

- `src/index.ts` — Nitro-hosted Hono app export
- `src/app.ts` — Hono 应用
- `src/routes/conversations.ts` / `agents.ts`
- `src/services/agent-runtime.ts` — route-facing Workflow run helpers
- `src/services/chat-agent.ts` — WorkflowAgent workflow function
- `src/clients/admin.ts` / `knowledge.ts` — chat facade over
  `@backend/transport-ts`
- `src/gen-openapi.ts` — `just gen-openapi chat` → `chat-server.json`

## 上传与文档

- 前端上传走 **knowledge** `POST /api/knowledge-server/ingest/stream`
- 会话详情中的 `documents` 来自 knowledge `list_documents`（按 `conversation_id` 过滤）
- 删会话只删 chat 两张表，不触达 knowledge

详见 [ADR-0004](../ADR/0004-chat-ts-knowledge-py.md) 与
[ADR-0005](../ADR/0005-chat-workflow-agent.md)。
