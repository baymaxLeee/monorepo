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
  - `POST   /conversations/{id}/agents/run/stream` 运行 OpenAI Agents SDK agent，
    模型可调用会话检索、会话文件读取、web search 与 artifact 写入工具；
    `write_artifacts` 会写入新的 `artifact` 文档，并通过 SSE 实时推送进度：
    - `message`：助手主回复，支持 `delta` 增量与最终 `text`
    - `step`：agent runtime 执行态，含 `status`、`tool_name`、`output_preview`
    - `card`：可选产物卡片，目前支持 `artifact` 文档 card
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
| `LLM_MAX_OUTPUT_TOKENS` | `1024` | 普通 chat completion 的显式输出 token 上限，避免 OpenAI-compatible 网关默认请求过大 |
| `PROVIDER_CACHE_TTL_SECONDS` | `300` | provider 快照本地缓存 TTL |
| `PROVIDER_CACHE_SIZE` | `256` | 本地缓存条目上限（LRU） |
| `ATTACHMENT_MAX_UPLOAD_BYTES` | `10485760` | MarkItDown demo 单附件上传上限 |
| `ATTACHMENT_MARKDOWN_MAX_CHARS` | `12000` | 单附件注入 LLM 前的 Markdown 字符上限 |
| `AGENT_MAX_TURNS` | `8` | Agents SDK 单次会话 agent run 最大 turn 数 |
| `AGENT_RUN_TIMEOUT_SECONDS` | `120` | 单次 agent run 的整体超时，覆盖多轮工具调用和流式等待 |
| `AGENT_MAX_OUTPUT_TOKENS` | `1024` | Agent runtime 单次模型调用输出 token 上限；provider `extra_body` 只能进一步降低，不能抬高 |
| `AGENT_ARTIFACT_MAX_FILES` | `3` | `write_artifacts` 单次最多写入的 artifact 数 |
| `AGENT_ARTIFACT_MAX_CHARS` | `20000` | 单个 artifact 内容字符上限 |
| `AGENT_ARTIFACT_TOTAL_MAX_CHARS` | `40000` | 单次 `write_artifacts` 总内容字符上限 |
| `AGENT_CONTEXT_RECENT_MESSAGES` | `10` | Agent 初始 prompt 注入的最近历史消息条数 |
| `AGENT_CONTEXT_MESSAGE_MAX_CHARS` | `1000` | 单条历史消息注入 preview 字符上限 |
| `AGENT_CONTEXT_DOCUMENT_PREVIEW_CHARS` | `1200` | 普通会话文档注入 preview 字符上限 |
| `AGENT_CONTEXT_SELECTED_DOCUMENT_PREVIEW_CHARS` | `4000` | 用户显式选中文档注入 preview 字符上限 |
| `AGENT_CONTEXT_MAX_CHARS` | `12000` | Agent 初始 prompt 的上下文字符预算，超出后优先截断旧历史/旧文档 |

## 入口文件

- `src/chat/main.py` — FastAPI app + lifespan（关闭 admin_client）
- `src/chat/routers/conversations.py` — HTTP 路由（含 SSE 流式终端）
- `src/chat/routers/documents.py` — 会话级 Markdown 文档上传/读取/编辑
- `src/chat/routers/agents.py` — OpenAI Agents SDK 会话文档 agent
- `src/chat/services/conversations.py` — 会话 CRUD 编排
- `src/chat/services/messages.py` — 用户/助手消息持久化 + LLM 流式拼装
- `src/chat/services/documents.py` — MarkItDown 转换后的 Markdown 文档持久化
- `src/chat/services/attachments.py` — `MarkItDown.convert_stream()` 封装
- `src/chat/services/agent_runtime.py` — Agents SDK runtime + SSE event 编排
- `src/chat/services/agent_tools.py` — runtime function tools
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
- Agent runtime 每次 run 都会注入当前会话的全部历史消息和全部会话文档
  （包含 source 与之前生成的 artifact），避免同一会话内前文和产物丢失。
- Agent runtime 注入的工具保持后端受控边界：
  `search_conversation` 只检索当前会话；`list_conversation_documents` /
  `read_document_markdown` 只访问当前会话文档；`web_search` 只做公网搜索结果检索；
  `write_artifacts` 只写当前会话 artifact，单文件和多文件都走同一个批量工具。
- Agent runtime 会显式设置 `max_tokens`，并裁剪 provider `extra_body` 中的
  `max_tokens` / `max_completion_tokens`，避免 OpenRouter 等网关默认 65536 token
  导致低余额账号在生成前直接 402。
- Agent runtime 不再把全量历史和全量文档直接塞进初始 prompt；初始上下文只放
  最近历史、文档索引和 preview，全文通过 `read_document_markdown` 分片读取，避免
  OpenRouter 低额度账号触发 prompt token limit。
- Agent runtime 默认禁用并行工具调用，提高 DeepSeek 等 OpenAI-compatible
  provider 下的 artifact 写入稳定性；artifact 工具成功后会立即通过 `card`
  SSE 事件推给前端，即使后续模型回合失败也能看到已生成产物。
- Agent 如需输出完整文件，应调用 `write_artifacts`，由 chat-server 在当前会话
  写入 `kind=artifact` 的 Markdown 文档，再通过同一 card/编辑器预览。
