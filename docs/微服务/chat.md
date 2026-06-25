# chat service

对话 / Agent Runtime 微服务（**TypeScript**, Hono + Vercel AI SDK + Drizzle）。
负责会话、消息与 agent runtime 事件流。文档与 artifact 由 **knowledge**
服务持久化；chat 是 knowledge 的**消费者**。

## Owner / 责任范围

- DB 表：`conversations`、`messages`（`conversation_documents` 已迁至 knowledge）
- HTTP API（gateway 暴露为 `/api/chat-server/conversations/*`）
  - `GET/POST /conversations` — 列表 / 新建
  - `GET/PATCH/DELETE /conversations/{id}` — 详情（含消息 + knowledge 文档列表）/ 更新 / 删除
  - `POST/GET /conversations/{id}/agents/run/stream` — agent SSE（start / resume）

## 不负责

- 用户身份（→ iam）
- 智能体 / LLM Provider 配置（→ admin）
- 文件上传、MarkItDown、artifact 存储（→ knowledge）
- 审计日志（→ audit，未来通过事件）

## LLM 上游

通过 `admin_client` 调 `GET admin:/internal/providers/*?user_id=<uid>`，
进程内 TTL 缓存 provider 快照。Vercel AI SDK `streamText` + OpenAI-compatible
provider（`@ai-sdk/openai-compatible`）。

## Agent runtime

- 工具：`list_documents`、`read_document`、`analyze_image`、`create_artifact`、`update_artifact`、`web_search`、`ask_user`、`propose_memory`
- `create_artifact` 只接收 `{ title, filename, kind, brief }`；工具内部用独立 `streamText` 生成正文，不设置服务内 token / 时间 / 字符上限，以 preliminary 流式输出供前端实时预览，normalize 后 POST knowledge 落库；final tool output 带 `document_id` 供前端 DocumentCard；`onFinish` 将 `[id]` 写入 `messages.content`
- `update_artifact` 只接收 `{ document_id, title?, filename?, kind?, brief }`；读取现有 artifact 全文后按 brief 生成完整修订版并 PATCH knowledge，同一个 `document_id` 的预览/下载指向最新内容
- 主循环、上下文拼装与产物生成都不设置服务内 token / 时间 / turn / 字符上限；`experimental_repairToolCall` 修复 malformed tool-call JSON
- SSE 事件：`step` / `message` / `card` / `error`；Redis stream 断线重放，不用 TTL / stale 秒数截断长任务

## 入口文件

- `src/index.ts` — Node HTTP 入口
- `src/app.ts` — Hono 应用
- `src/routes/conversations.ts` / `agents.ts`
- `src/services/agent-runtime.ts` — Vercel AI SDK tool loop
- `src/services/agent-streams.ts` — Redis SSE 重放
- `src/clients/admin.ts` / `knowledge.ts`
- `src/gen-openapi.ts` — `just gen-openapi chat` → `chat-server.json`

## 上传与文档

- 前端上传走 **knowledge** `POST /api/knowledge-server/ingest/stream`
- 会话详情中的 `documents` 来自 knowledge `list_documents`（按 `conversation_id` 过滤）
- 删会话只删 chat 两张表，不触达 knowledge

详见 [ADR-0004](../ADR/0004-chat-ts-knowledge-py.md)。
