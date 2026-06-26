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
- Workflow World：本地可用 Local World；部署使用 `@workflow/world-postgres`。
- Version guard：`agent_runs.workflow_version` 与当前 `CHAT_WORKFLOW_VERSION` 不一致时拒绝 resume/cancel。
- 工具：`list_documents`、`read_document`、`analyze_image`、`create_artifact`、`update_artifact`、`web_search`、`ask_user`、`propose_memory`
- `create_artifact` 只接收 `{ title, filename, kind, brief }`；工具内部用独立 `streamText` 生成正文，normalize 后 POST knowledge 落库；final tool output 带 `document_id` 供前端 DocumentCard；Workflow 完成时服务端持久化 assistant 总结，若模型未产出最终文本则从成功的 artifact tool result 生成确定性总结。
- `update_artifact` 只接收 `{ document_id, title?, filename?, kind?, brief }`；读取现有 artifact 全文后按 brief 生成完整修订版并 PATCH knowledge，同一个 `document_id` 的预览/下载指向最新内容
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
