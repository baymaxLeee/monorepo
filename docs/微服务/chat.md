# chat service

对话/Agent Runtime 微服务。负责会话、消息、会话文档与 agent runtime
事件流。前端只通过 agent runtime SSE 路径发起模型调用。**不**持有任何 LLM
凭据 —— 模型 Provider 由 admin 拥有。

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
  - `POST   /conversations/{id}/agents/run/stream` 运行 OpenAI-compatible agent runtime，
    模型可调用会话文件读取、image analysis 与 web search 工具；产物通过
    最终回复中的 `<artifact title="..." filename="...">...</artifact>` block 由服务端落库，
    并通过 SSE 实时推送进度：
    - `message`：助手主回复，支持 `delta` 增量与最终 `text`
    - `step`：agent runtime 执行态，含 `status`、`tool_name`、`output_preview`
    - `card`：可选产物卡片，目前支持 `artifact` 文档 card

## 不负责

- 用户身份（→ iam）
- 智能体管理（→ admin）
- **LLM Provider 配置（→ admin 的 `model_providers` 域）**
- 审计日志（→ audit，未来通过事件）

## LLM 上游：通过 admin 解耦

chat 在每次 agent runtime run 时按 `(user_id, provider_id?)` 向 admin 请求一份
**解密后**的 provider 快照：

```
GET admin:/internal/providers/{id}?user_id=<uid>     # 显式指定
GET admin:/internal/providers/default?user_id=<uid>  # 用户默认
Header: X-Internal-Token: <INTERNAL_API_TOKEN>
```

- 快照在 chat 进程内缓存 TTL≈5min（`cachetools.TTLCache`），admin 端的
  改动通过自然过期生效，无需跨服务失效通知。
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
| `AGENT_MAX_TURNS` | `120` | 单次 agent run 最大模型/工具循环轮数，允许长任务多轮工具调用 |
| `AGENT_RUN_TIMEOUT_SECONDS` | `3600` | 单次 agent run 的整体超时，覆盖多轮工具调用和流式等待 |
| `AGENT_MAX_OUTPUT_TOKENS` | `512` | Agent runtime 单次模型调用输出 token 上限；provider `extra_body` 只能进一步降低，不能抬高 |
| `AGENT_ARTIFACT_MAX_FILES` | `3` | 单次 agent 回复最多落库的 artifact 数 |
| `AGENT_ARTIFACT_MAX_CHARS` | `20000` | 单个 artifact 内容字符上限 |
| `AGENT_ARTIFACT_TOTAL_MAX_CHARS` | `40000` | 单次 agent 回复 artifact 总内容字符上限 |
| `AGENT_CONTEXT_RECENT_MESSAGES` | `10` | Agent 初始 prompt 注入的最近历史消息条数 |
| `AGENT_CONTEXT_MESSAGE_MAX_CHARS` | `1000` | 单条历史消息注入 preview 字符上限 |
| `AGENT_CONTEXT_DOCUMENT_PREVIEW_CHARS` | `1200` | 普通会话文档注入 preview 字符上限 |
| `AGENT_CONTEXT_SELECTED_DOCUMENT_PREVIEW_CHARS` | `4000` | 用户显式选中文档注入 preview 字符上限 |
| `AGENT_CONTEXT_MAX_CHARS` | `12000` | Agent 初始 prompt 的上下文字符预算，超出后优先截断旧历史/旧文档 |

## 入口文件

- `src/chat/main.py` — FastAPI app + lifespan（关闭 admin_client）
- `src/chat/routers/conversations.py` — 会话 CRUD 路由
- `src/chat/routers/documents.py` — 会话级 Markdown 文档上传/读取/编辑
- `src/chat/routers/agents.py` — 会话文档 agent SSE 路由
- `src/chat/services/conversations.py` — 会话 CRUD 编排
- `src/chat/services/documents.py` — MarkItDown 转换后的 Markdown 文档持久化
- `src/chat/services/attachments.py` — `MarkItDown.convert_stream()` 封装
- `src/chat/services/agent_runtime.py` — OpenAI-compatible Chat Completions tool loop + SSE event 编排
- `src/chat/services/agent_tools.py` — runtime function tools（含 `analyze_image` 多模态工具）
- `src/chat/services/admin_client.py` — admin `/internal/providers/*` 客户端 + TTL 缓存
- `src/chat/crud/` / `models/` / `schemas/` — 表对应分层
- `src/chat/gen_openapi.py` — `just gen-openapi chat`

## 关键约束

- 路由薄、业务在 services、持久化在 crud；不混用。
- 错误统一走 `kernel.errors.*` / `BaseError` 子类，禁用裸 `HTTPException`。
- **Agent SSE 路由对鉴权 + provider 校验做 pre-flight**：会话不存在 → 404 JSON；
  provider 未配置 → 412 JSON。响应头一旦发出，4xx 就回不去了。
- 持久化顺序：先 resolve provider → 写 user message → 流 agent runtime →
  写 assistant message。Provider 失败时不留 dangling 用户消息。
- conversation 行有 `provider_id` 列，第一次 agent run 时自动 pin，后续 run 默认
  沿用同一 provider（前端可显式 override）。
- 附件转换只接受浏览器上传的文件流，不接受 URL / 本地 path；转换前校验大小，
  转换后截断 Markdown，避免 demo 请求无限放大。
- 会话文档引用约定为 `[[chat-document:<id>]]`。前端据此渲染 card，点击后通过
  `MarkdownEditor` 读取并编辑 `conversation_documents.content_md`。
- Agent runtime 使用 OpenAI-compatible Chat Completions API，由 chat-server 自管
  tool loop；每个 assistant `tool_calls` 后都会立即补齐对应 `tool_call_id` 的
  `tool` message，再进入下一轮模型调用。provider 仍由 admin 解密下发。
- Agent runtime 每次 run 都会加载当前会话的全部历史消息和全部会话文档
  （包含 source 与之前生成的 artifact），但初始 prompt 只注入预算内 preview；
  需要全文时通过工具分片读取，避免 prompt 超窗。
- Agent runtime 注入的工具保持后端受控边界：
  `list_conversation_documents` / `read_document_markdown` 只访问当前会话文档；`analyze_image` 只根据
  `conversation_documents` 中的 storage object metadata 从 storage-server 读取当前会话上传的
  原始 image payload，并调用请求指定的 `multimodal_provider_id`；`web_search` 只做公网搜索结果检索。
- Agent runtime 会显式设置 `max_tokens`，并裁剪 provider `extra_body` 中的
  `max_tokens` / `max_completion_tokens`，避免 OpenRouter 等网关默认 65536 token
  导致低余额账号在生成前直接 402。
- Agent runtime 不再把全量历史和全量文档直接塞进初始 prompt；初始上下文只放
  最近历史、文档索引和 preview，全文通过 `read_document_markdown` 分片读取，避免
  OpenRouter 低额度账号触发 prompt token limit。
- 第一版多模型 agent 采用 tool delegation：主 provider 负责 agent loop 和推理；
  豆包/Seed 等多模态 provider 通过 `analyze_image(document_id, question)` 按需调用，
  返回文本分析结果给主 agent 继续推理。视频暂不接入。
- Agent runtime 默认禁用并行工具调用，提高 DeepSeek 等 OpenAI-compatible
  provider 下的工具调用稳定性。
- Agent 如需输出完整文件，应在最终回复里输出 artifact block；chat-server 会解析
  block 并在当前会话写入 `kind=artifact` 的 Markdown 文档，再通过同一 card/编辑器预览。
  大段 HTML/Markdown 不再进入 function-call JSON，避免模型生成非法 tool arguments。
