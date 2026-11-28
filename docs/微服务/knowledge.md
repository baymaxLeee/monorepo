# Knowledge 服务

`knowledge` 是面向 AI 运行时的语义文档服务。它拥有文档解析、索引和检索；平台所有
原始与生成文件的字节、不可变版本、交付和物理回收统一由 `storage` 服务管理。
Agent 的临时工作区由 Runtime sandbox role 承载，会话文件/Plan 的业务引用归 Runtime。

## 职责边界

Knowledge 负责：

- 将 Storage revision 解析为 Markdown，并维护转换、索引和处理状态。
- `documents` 语义生命周期与用户导入的 `source` 文档。
- PostgreSQL + pgvector 上的 chunk、混合检索、RRF 与 rerank。
- 面向用户的文档 CRUD，以及面向 Runtime 的只读 `knowledge_search` MCP 能力。

Knowledge 不负责：

- 文件字节、filesystem path、bucket、object key 或存储驱动。
- 上传暂存、签名下载、物理保留策略和垃圾回收。
- 对话消息与 agent runtime。

这些物理文件职责属于 Storage。Knowledge 只保存 `asset_id + revision_id`，并通过
durable Claim intent 将引用激活或释放；不得把物理 locator 重新引入业务模型。

## 端口与入口

- 公开 HTTP：`8010`
- 内部 MCP：同一 `8010` 端口的 `/mcp`，只接受 Runtime workload credential
- Gateway 对外：`/api/knowledge-server`
- Storage RPC：`STORAGE_RPC_TARGET`，默认 `localhost:9013`

| 路径 | 鉴权 | 说明 |
|---|---|---|
| `POST /ingest` | Gateway 用户 JWT | 接收文档引用，同步完成 Markdown 转换与 RAG 索引 |
| `GET/PATCH/DELETE /documents/*` | Gateway 用户 JWT | 用户文档管理 |

Knowledge 不再运行 gRPC server，也不保留旧 Document/StagedMedia/Conversation/Retrieval
RPC adapter。Runtime 只通过受保护的 `/mcp` 执行检索；文档生命周期仍由公开 owner API 管理。

文件进入 Knowledge 后继续以不可变 Storage revision 为原件，由 MarkItDown 将 PDF、Office、
HTML、纯文本等支持格式转换为 Markdown；图片使用有视觉输入能力的 provider 生成 Markdown
描述。转换后的 Markdown 受独立的大文档安全上限保护，但不能用面向单次 prompt 的小窗口截断
整份可索引文档。

字节上传和内容读取使用 Storage API，不经过 Knowledge 的 public media route。

## Agent MCP surface

Knowledge 同一服务进程挂载官方 Python MCP SDK 的 stateless Streamable HTTP `/mcp`。它只接受
`x-caller-service=runtime` 及完整 user/tenant/workspace/role identity headers，并通过现有 retrieval
application 查询当前 workspace；edge 请求不能直接调用。当前 inventory 严格只有
`knowledge_search`，返回的文档内容标记为 untrusted。Runtime 不再持有内建 Knowledge search tool；
Admin release 负责固定 endpoint、schema 和 source projection，执行与 cleanup 由共享插件 runtime
负责，见 [Agent plugin ADR](../ADR/agent-plugins.md)。

## 数据模型

`documents` 保存业务与处理状态，核心引用为：

- `user_id` / `tenant_id` / `workspace_id` / `conversation_id`：业务归属与来源。
- `kind`：`source` 或 `artifact`；这是语义文档分类，不是存储类型。
- `asset_id` / `revision_id`：精确指向不可变 Storage revision。
- `content_md`：解析或编辑产生的可检索文本投影；原件以 Storage revision 为事实源。
- `editable_source`：可编辑文档；每次编辑先写新 Storage revision，再以版本校验切换引用。
- `ingest_status` / `index_status`：耐久转换与索引意图。

显式导入的 Knowledge 文档可通过 Runtime 的来源刷新操作导入只读 `sources/documents/*`。Web Chat 普通附件由 Runtime 登记为会话文件，原件由 Storage 提供。

## Storage 生命周期协作

上传先进入 Storage 并得到 immutable revision。Knowledge 在本地业务事务中同时写入
文档和 Claim intent；独立 relay 以幂等的 prepare/activate/release 调用推进平台 Claim。
因此数据库提交与跨服务调用之间不存在悬空引用窗口，重启和至少一次投递也不会改变
最终所有权。删除文档只释放 Claim，物理删除由 Storage 的 retention、GC 和 deletion
fencing 决定。

## 与 Runtime 的关系

- Runtime server 只在用户选择系统 Knowledge 插件时调用 `/mcp` 的 `knowledge_search`；它不读取
  Knowledge 数据库，也不调用旧的文档复制、会话清理或 staged-media API。
- Runtime-owned 会话文件与 Plan 留在 Runtime/Storage；Knowledge source 文档拥有独立生命周期。

## 同步文档处理

Knowledge 在 source ingest 请求内依次执行转换与索引，完成后才返回。批量 ingest 使用
`INGEST_MAX_PARALLEL` 限制并发；convert/index command 保持幂等，并用 PostgreSQL
advisory lock 串行化同一 document。失败直接写入文档状态并反映到请求结果，不经过
Runtime worker 或独立 document worker。没有 embedding provider 时仍写入 `embedding=NULL`
的 lexical chunks，保证 pg_trgm sparse-only 检索可用。升级前遗留的 pending/failed
source 会在下一次读取或显式 reindex 时用同一路径同步收敛。

分块按中英文混合文本估算 token，避免中文沿用 `4 chars/token` 形成超大 chunk。Contextual
Retrieval 的上下文同时进入 dense、pg_trgm lexical 和 rerank 候选，但对 Agent 返回的仍是原始
chunk；dense 查询只使用当前 embedding model 的向量空间，并对带 workspace 过滤的 HNSW 使用
iterative scan。复杂问题的分解、并行或后续补查由现有单 Agent ToolLoop 多次调用
`knowledge_search` 完成，Knowledge 内部不再嵌套第二个 Agent 或答案生成器。

业务表与 RAG 向量统一存储在 PostgreSQL + pgvector。single-VPS 的统一 `db-init`
容器使用 Knowledge 专属 role 执行服务自有迁移，再启动 API 容器，应用启动时不隐式
修改 schema。

## 开发

```bash
cd apps/backend
just dev knowledge
just gen-openapi knowledge
```

OpenAPI 输出：`schemas/openapi/knowledge-server.json`。生成文件必须从服务源码重建，
不要手工修改。
