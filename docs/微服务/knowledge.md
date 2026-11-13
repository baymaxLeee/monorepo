# Knowledge 服务

`knowledge` 是面向 AI 运行时的语义文档服务。它拥有文档解析、索引和检索；平台所有
原始与生成文件的字节、不可变版本、交付和物理回收统一由 `storage` 服务管理。
Agent 的临时工作区归 Sandbox，会话文件/Plan 的业务引用归 Chat。

## 职责边界

Knowledge 负责：

- 将 Storage revision 解析为 Markdown，并维护转换、索引和处理状态。
- `documents` 语义生命周期，包括用户上传的 `source` 与 agent 生成的 `artifact`。
- PostgreSQL + pgvector 上的 chunk、混合检索、RRF 与 rerank。
- 面向用户的文档 CRUD，以及面向 Chat/Executor 的内部语义与媒体发布 API。

Knowledge 不负责：

- 文件字节、filesystem path、bucket、object key 或存储驱动。
- 上传暂存、签名下载、物理保留策略和垃圾回收。
- 对话消息与 agent runtime。

这些物理文件职责属于 Storage。Knowledge 只保存 `asset_id + revision_id`，并通过
durable Claim intent 将引用激活或释放；不得把物理 locator 重新引入业务模型。

## 端口与入口

- 本地 / K8s：`8010`
- Gateway 对外：`/api/knowledge-server`
- Storage：`STORAGE_SERVICE_URL`，默认 `http://localhost:8013`

| 路径 | 鉴权 | 说明 |
|---|---|---|
| `POST /ingest` | Gateway 用户 JWT | 接收文档引用，同步完成 Markdown 转换与 RAG 索引 |
| `GET/PATCH/DELETE /documents/*` | Gateway 用户 JWT | 用户文档管理 |
| `/internal/documents/*` | per-caller service identity | Chat/Executor 读写语义文档 |
| `POST /internal/conversation-forks` | per-caller service identity | 按用户/tenant/workspace 复制当前不可变文档引用，返回 document id 映射 |
| `POST /internal/retrieve` | per-caller service identity | 用户作用域混合检索 |

字节上传和内容读取使用 Storage API，不经过 Knowledge 的 public media route。

会话分支在与写入/清理相同的会话锁内检查源和目标 tombstone、目标为空以及资源 scope。
复制文档为不再索引的只读 artifact 快照；原 source 文档继续独立保留。副本沿用精确的
Asset/revision，生成新的 document owner 与 durable Claim intent。返回映射用于 Chat
重写消息中的 document id；读取仍使用 Markdown 语义投影，下载使用原字节。
正在转换的文档和未迁移的原件引用拒绝复制。Chat 负责消息分支与失败补偿。

## 数据模型

`documents` 保存业务与处理状态，核心引用为：

- `user_id` / `tenant_id` / `workspace_id` / `conversation_id`：业务归属与来源。
- `kind`：`source` 或 `artifact`；这是语义文档分类，不是存储类型。
- `asset_id` / `revision_id`：精确指向不可变 Storage revision。
- `content_md`：解析或编辑产生的可检索文本投影；原件以 Storage revision 为事实源。
- `editable_source`：可编辑文档；每次编辑先写新 Storage revision，再以版本校验切换引用。
- `ingest_status` / `index_status`：耐久转换与索引意图。

用户上传的 source 文档和 Chat 会话中引用的 document 在授权后由 Sandbox 以只读
`sources/documents/*` 快照导入。普通 Agent 文件的创建、发现和发布由 Sandbox、Chat
与 Storage 完成。

## Storage 生命周期协作

上传先进入 Storage 并得到 immutable revision。Knowledge 在本地业务事务中同时写入
文档和 Claim intent；独立 relay 以幂等的 prepare/activate/release 调用推进平台 Claim。
因此数据库提交与跨服务调用之间不存在悬空引用窗口，重启和至少一次投递也不会改变
最终所有权。删除文档只释放 Claim，物理删除由 Storage 的 retention、GC 和 deletion
fencing 决定。

## 与 Chat 和 Executor 的关系

- Chat 通过生成的 transport client 读取/复制语义文档；它不读取 Knowledge 数据库。
  Chat-owned `conversation_files`、Plan 与对应 Claim intent 留在 Chat 自己的数据库。
- 删除会话时，Chat 通过事务 outbox 请求 Knowledge 幂等清理该会话生成的 document
  artifact 与 staged media，并释放关联 Storage Claims。用户独立拥有的 source 保留。
- Knowledge 保存 conversation tombstone，拒绝已删除会话的迟到生成写入。
- Executor 的视频制片 workflow 使用 Knowledge 的 staged media 发布 API，但不参与
  source 文档转换或索引。

## 同步文档处理

Knowledge 在 source ingest 请求内依次执行转换与索引，完成后才返回。批量 ingest 使用
`INGEST_MAX_PARALLEL` 限制并发；convert/index command 保持幂等，并用 PostgreSQL
advisory lock 串行化同一 document。失败直接写入文档状态并反映到请求结果，不经过
Executor 或独立 document worker。没有 embedding provider 时仍写入 `embedding=NULL`
的 lexical chunks，保证 pg_trgm sparse-only 检索可用。升级前遗留的 pending/failed
source 会在下一次读取或显式 reindex 时用同一路径同步收敛。

业务表与 RAG 向量统一存储在 PostgreSQL + pgvector。single-VPS 的统一 `db-init`
容器使用 Knowledge 专属 role 执行服务自有迁移，再启动 API 容器，应用启动时不隐式
修改 schema。

## 开发

```bash
cd apps/backend
just dev knowledge
just gen-openapi knowledge
just gen-transport-ts
```

OpenAPI 输出：`schemas/openapi/knowledge-server.json`。生成文件必须从服务源码重建，
不要手工修改。
