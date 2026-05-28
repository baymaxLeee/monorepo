# chat service

对话/大模型微服务。负责会话与消息的持久化，并把上游大模型的输出以 SSE
形式回流给前端。

## Owner / 责任范围

- DB 表：`conversations`、`messages`（外加 `migration` 单行版本表）
- HTTP API（内部 `/conversations/*`；gateway 暴露为
  `/api/chat-server/conversations/*`）
  - `GET    /conversations` 列表（按 `updated_at desc`）
  - `POST   /conversations` 新建
  - `GET    /conversations/{id}` 详情（含消息列表）
  - `PATCH  /conversations/{id}` 更新标题
  - `DELETE /conversations/{id}` 删除（消息级联）
  - `POST   /conversations/{id}/messages` 发用户消息 + SSE 流式返回 assistant
    增量（`text/event-stream`，每帧 `data: <json-string>`，结束 `data: [DONE]`）

## 不负责

- 用户身份（→ iam）
- 智能体管理（→ admin）
- 审计日志（→ audit，未来通过事件）

## LLM 上游

任何兼容 OpenAI `/v1/chat/completions` 的 HTTP 服务都可以直接接入：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | 也可指向 DeepSeek / Doubao / Moonshot / vLLM 等 |
| `OPENAI_API_KEY` | （空） | 空 → 自动切到内置 echo mock，保证 demo 可跑 |
| `OPENAI_MODEL` | `gpt-4o-mini` | 任意兼容模型名 |
| `LLM_TIMEOUT_SECONDS` | `60` | 单次调用超时 |

## 入口文件

- `src/chat/main.py` — FastAPI app
- `src/chat/routers/conversations.py` — HTTP 路由（含 SSE 流式终端）
- `src/chat/services/conversations.py` — 会话 CRUD 编排
- `src/chat/services/messages.py` — 用户/助手消息持久化 + LLM 流式拼装
- `src/chat/services/llm.py` — OpenAI 兼容客户端 + mock 回退
- `src/chat/crud/` / `models/` / `schemas/` — 表对应分层
- `src/chat/gen_openapi.py` — `just gen-openapi chat`

## 关键约束

- 路由薄、业务在 services、持久化在 crud；不混用。
- 错误统一走 `kernel.errors.*`，禁用裸 `HTTPException`。
- SSE 流路由先持久化 `role=user` 消息，流结束后一次性写 `role=assistant`；
  上游失败时把已收到的内容标记 `status=failed` 入库并向客户端追加错误说明。
