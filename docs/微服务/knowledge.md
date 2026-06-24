# knowledge 服务

`knowledge` 是 Python 实现的知识库边界服务，由原 Go `storage` 服务演进而来。

## 职责

- 原始文件字节存储（demo 阶段：本地 filesystem `KNOWLEDGE_DATA_DIR`）
- MarkItDown 文档转换 → `content_md`
- `documents` 单表：同时保存 `object_key`（原始文件）与 `content_md`（转换结果）
- 上传 ingest（SSE 进度）
- Agent artifact 持久化（`POST /internal/artifacts`）
- 面向用户的文档 CRUD（未来知识库 app）

## 端口

- 本地 / K8s：`8010`
- Gateway 对外：`/api/knowledge-server`

## 数据模型

`documents` 表字段要点：

- `user_id` — 归属用户（产物持久，不随 chat 会话删除）
- `conversation_id` — 可选标签，标记来源会话
- `kind` — `source` | `artifact`
- `object_bucket` / `object_key` / `object_sha256` — 原始对象
- `content_md` — MarkItDown 或 artifact 正文
- `ingest_status` / `ingest_progress` — 上传流水线状态

## API 分层

| 路径 | 鉴权 | 说明 |
|---|---|---|
| `POST /ingest/stream` | Gateway 用户 JWT | 多文件上传 + SSE |
| `GET/PATCH/DELETE /documents/*` | Gateway 用户 JWT | 用户文档管理 |
| `GET/POST/DELETE /internal/*` | `X-Internal-Token` | chat 等 sibling 服务调用 |

## 与 chat 的关系

- **chat 是消费者**：通过 `knowledge_client` 调 `/internal/documents` 拉取上下文、写入 artifact。
- 删除 chat 会话只删 `conversations` + `messages`，**不**删除 knowledge 中的文档。
- 消息中的 `[16hex]` slot 引用 knowledge `documents.id`。

## 开发

```bash
cd apps/backend
just dev knowledge    # 或 just dev 全栈
just gen-openapi knowledge
```

OpenAPI 输出：`schemas/openapi/knowledge-server.json`
