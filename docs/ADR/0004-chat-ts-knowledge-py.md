# ADR-0004: chat → TypeScript + storage → knowledge (Python)

## Status

Accepted — 2026-06

## Context

- `chat` 原为 Python FastAPI 服务，同时拥有会话、消息、文档 ingest、MarkItDown、storage 客户端与 agent runtime。
- `storage` 为 Go 对象存储微服务，chat 通过内部 HTTP 存取原始字节。
- Agent artifact 采用内联 `<artifact>` 块与多步 start/append/finish workaround，难以与流式 tool calling 对齐。

## Decision

1. **chat-server 重写为 TypeScript**（Hono + Drizzle + ioredis + Vercel AI SDK）
   - 仅拥有 `conversations` + `messages` + agent runtime + Redis SSE 重放
   - 文档与产物改由 knowledge 服务承载

2. **storage 下线，由 Python `knowledge` 服务替代**
   - FastAPI + MarkItDown
   - `documents` 单表：`object_key` + `content_md`
   - 提供 HTTP ingest、artifact 写入、内部/公开文档 API

3. **artifact 机制重设计（不兼容旧方案）**
   - 统一 `create_artifact` 工具 → POST knowledge 落库 → 占位符 `⟦artifact:N⟧` → turn 结束回填 `[id]`
   - 废弃内联 `<artifact>` 与 JSON salvage

4. **Gateway**
   - 保留 `/api/chat-server`
   - 新增 `/api/knowledge-server`（上传与未来知识库 app）

5. **后端工具链**
   - `apps/backend/justfile` 新增 `NODE_SERVICES` 分支（首例 Node 服务：chat）

## Consequences

- 删会话不删用户知识库产物；悬空 `[id]` 引用在 `read_document` 时优雅降级。
- 数据迁移：storage → knowledge 已完成；`storage` 微服务与 `storage` 数据库已下线。
- chat `conversation_documents` 表在 v1.5.0 迁移中删除。
- CI：`build-images` chat 使用 Node context；matrix 中 storage → knowledge。
- demo 阶段不新增测试脚手架（见根 `AGENTS.md`）。

## Alternatives considered

- 保留 Python chat + 仅拆 storage → 拒绝：agent runtime 与 Vercel AI SDK 生态更契合 TS 消费层。
- chat 继续拥有 documents 表 + 调 storage → 拒绝：知识库应独立持久化，供未来 KB app 复用。
