# chat service

对话/大模型微服务。负责会话与消息的持久化，并把上游大模型的输出以 SSE
形式回流给前端。**不**持有任何 LLM 凭据 —— 模型 Provider 由 admin 拥有。

## Owner / 责任范围

- DB 表：`conversations`、`messages`（外加 `migration` 单行版本表）
- HTTP API（内部 `/conversations/*`；gateway 暴露为
  `/api/chat-server/conversations/*`）
  - `GET    /conversations` 列表（按 `updated_at desc`）
  - `POST   /conversations` 新建（可选 `provider_id` 预绑定）
  - `GET    /conversations/{id}` 详情（含消息列表）
  - `PATCH  /conversations/{id}` 更新标题
  - `DELETE /conversations/{id}` 删除（消息级联）
  - `POST   /conversations/{id}/messages` 发用户消息 + SSE 流式返回 assistant
    增量（`text/event-stream`，每帧 `data: <json-string>`，结束 `data: [DONE]`）
    - 可选 body：`provider_id`（按需切换模型）、`thinking`、`reasoning_effort`
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

## 入口文件

- `src/chat/main.py` — FastAPI app + lifespan（关闭 admin_client）
- `src/chat/routers/conversations.py` — HTTP 路由（含 SSE 流式终端）
- `src/chat/services/conversations.py` — 会话 CRUD 编排
- `src/chat/services/messages.py` — 用户/助手消息持久化 + LLM 流式拼装
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
