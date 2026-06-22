# chat service

对话/大模型微服务。负责会话与消息的持久化，并把上游大模型的输出以 SSE
形式回流给前端。**不**持有任何 LLM 凭据 —— 模型 Provider 由 admin 拥有。

## Owner / 责任范围

- DB 表：`conversations`、`messages`、`conversation_documents`（外加
  `migration` 单行版本表）
- HTTP API（内部 `/conversations/*`；gateway 暴露为
  `/api/chat-server/conversations/*`）
  - `GET    /conversations` 列表（按 `updated_at desc`）
  - `POST   /conversations` 新建（可选 `provider_id` 预绑定）
  - `GET    /conversations/{id}` 详情（含消息列表与会话文档列表）
  - `PATCH  /conversations/{id}` 更新标题
  - `DELETE /conversations/{id}` 删除（消息级联）
  - `GET    /conversations/{id}/documents` 列出会话内 Markdown 文档
  - `POST   /conversations/{id}/documents` 上传文件并用 Microsoft MarkItDown
    转成 Markdown，作为 `source` 文档落库
  - `GET    /conversations/{id}/documents/{document_id}` 读取完整 Markdown
    内容，供前端预览/二次编辑
  - `PATCH  /conversations/{id}/documents/{document_id}` 保存 Markdown 编辑结果
  - `POST   /attachments/convert` 上传单个附件并用 Microsoft MarkItDown 转成
    Markdown，保留为轻量 demo/兼容接口；主流程使用 documents 落库接口
  - `POST   /conversations/{id}/agents/run` 运行 OpenAI Agents SDK agent，模型可调用
    `list_conversation_documents` / `read_document_markdown` / `write_artifact`
    工具；`write_artifact` 会写入新的 `artifact` 文档
  - `POST   /conversations/{id}/agents/run/stream` 同上，但通过 SSE 实时推送进度：
    - `step`：每个执行阶段一条文本
    - `summary_delta`：模型回复的增量 token
    - `artifacts`：run 结束时批量返回新建的 artifact 文档
    - `done`：最终 message 与 tool_calls
  - `POST   /conversations/{id}/messages` 发用户消息 + SSE 流式返回 assistant
    增量（`text/event-stream`，每帧 `data: <json-string>`，结束 `data: [DONE]`）
    - 可选 body：`provider_id`（按需切换模型）、`thinking`、`reasoning_effort`
    - 可选 body：`document_ids[]`，引用当前会话的 Markdown 文档；消息正文会持久化
      `[[chat-document:<id>]]` card 标记，LLM history 注入文档 Markdown
    - 鉴权/Provider 校验在 SSE 头发送**之前**完成，4xx 走结构化 JSON 错误

## 不负责

- 用户身份（→ iam）
- 智能体管理（→ admin）
- **LLM Provider 配置（→ admin 的 `model_providers` 域）**
- 审计日志（→ audit，未来通过事件）

## LLM 上游：通过 admin 解耦

chat 在每次发消息时按 `(user_id, provider_id?)` 向 admin 请求一份
**解密后**的 provider 快照：

```
GET admin:/internal/providers/{id}?user_id=<uid>     # 显式指定
GET admin:/internal/providers/default?user_id=<uid>  # 用户默认
Header: X-Internal-Token: <INTERNAL_API_TOKEN>
```

- 快照在 chat 进程内缓存 TTL≈5min（`cachetools.TTLCache`），admin 端的
  改动通过自然过期生效，无需跨服务失效通知。
- LLMClient 不再读 settings；用 `LLMClient.from_provider(snapshot)` 构造，
  调用结束即 `aclose()` 释放 TCP。
- 没有 mock 回退 —— 没配置 provider 时返回 412 `provider_not_configured`，
  前端引导用户去 Admin → 模型管理 配置。

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `ADMIN_SERVICE_URL` | `http://localhost:8001` | admin 微服务地址 |
| `INTERNAL_API_TOKEN` | （dev fallback） | 与 admin 共享的服务级密钥 |
| `LLM_TIMEOUT_SECONDS` | `60` | 单次上游调用超时 |
| `PROVIDER_CACHE_TTL_SECONDS` | `300` | provider 快照本地缓存 TTL |
| `PROVIDER_CACHE_SIZE` | `256` | 本地缓存条目上限（LRU） |
| `ATTACHMENT_MAX_UPLOAD_BYTES` | `10485760` | MarkItDown demo 单附件上传上限 |
| `ATTACHMENT_MARKDOWN_MAX_CHARS` | `12000` | 单附件注入 LLM 前的 Markdown 字符上限 |
| `AGENT_MAX_TURNS` | `8` | Agents SDK 单次会话 agent run 最大 turn 数 |

## 入口文件

- `src/chat/main.py` — FastAPI app + lifespan（关闭 admin_client）
- `src/chat/routers/conversations.py` — HTTP 路由（含 SSE 流式终端）
- `src/chat/routers/documents.py` — 会话级 Markdown 文档上传/读取/编辑
- `src/chat/routers/attachments.py` — MarkItDown 附件转 Markdown demo
- `src/chat/routers/agents.py` — OpenAI Agents SDK 会话文档 agent
- `src/chat/services/conversations.py` — 会话 CRUD 编排
- `src/chat/services/messages.py` — 用户/助手消息持久化 + LLM 流式拼装
- `src/chat/services/documents.py` — MarkItDown 转换后的 Markdown 文档持久化
- `src/chat/services/attachments.py` — `MarkItDown.convert_stream()` 封装
- `src/chat/services/agent_runtime.py` — Agents SDK runtime + function tools
- `src/chat/services/llm.py` — `LLMClient.from_provider(snapshot)` —— 纯 IO，无 secret
- `src/chat/services/admin_client.py` — admin `/internal/providers/*` 客户端 + TTL 缓存
- `src/chat/crud/` / `models/` / `schemas/` — 表对应分层
- `src/chat/gen_openapi.py` — `just gen-openapi chat`

## 关键约束

- 路由薄、业务在 services、持久化在 crud；不混用。
- 错误统一走 `kernel.errors.*` / `BaseError` 子类，禁用裸 `HTTPException`。
- **SSE 路由对鉴权 + provider 校验做 pre-flight**：会话不存在 → 404 JSON；
  provider 未配置 → 412 JSON。响应头一旦发出，4xx 就回不去了。
- 持久化顺序：先 resolve provider → 写 user message → 流 LLM → 写 assistant
  message。Provider 失败时不留 dangling 用户消息。
- conversation 行有 `provider_id` 列，第一次发消息时自动 pin，后续消息默认
  沿用同一 provider（前端可显式 override）。
- 附件转换只接受浏览器上传的文件流，不接受 URL / 本地 path；转换前校验大小，
  转换后截断 Markdown，避免 demo 请求无限放大。
- 会话文档引用约定为 `[[chat-document:<id>]]`。前端据此渲染 card，点击后通过
  `MarkdownEditor` 读取并编辑 `conversation_documents.content_md`。
- Agent runtime 使用 `OpenAIChatCompletionsModel`，可对接 DeepSeek 等
  OpenAI-compatible Chat Completions provider；provider 仍由 admin 解密下发。
- Agent 如需输出完整文件，应调用 `write_artifact`，由 chat-server 在当前会话
  写入 `kind=artifact` 的 Markdown 文档，再通过同一 card/编辑器预览。
