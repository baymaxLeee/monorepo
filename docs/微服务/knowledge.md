# Knowledge 服务

`knowledge` 是面向 AI 运行时的语义文档与虚拟工作区服务。它拥有解析、索引、
检索和 agent 可编辑文件树；平台所有原始与生成文件的字节、不可变版本、交付和
物理回收统一由 `storage` 服务管理。

## 职责边界

Knowledge 负责：

- 将 Storage revision 解析为 Markdown，并维护转换、索引和处理状态。
- `documents` 语义生命周期，包括用户上传的 `source` 与 agent 生成的 `artifact`。
- PostgreSQL + pgvector 上的 chunk、混合检索、RRF 与 rerank。
- 会话级虚拟文件树、per-deliverable change set staging 与原子发布。
- 面向用户的文档 CRUD，以及面向 Chat/Executor 的内部语义 API。

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
| `POST /ingest` | Gateway 用户 JWT | 接收文档引用并启动耐久处理 |
| `GET/PATCH/DELETE /documents/*` | Gateway 用户 JWT | 用户文档管理 |
| `/internal/documents/*` | per-caller service identity | Chat/Executor 读写语义文档 |
| `/internal/files/*` | per-caller service identity | agent 虚拟文件树与 change set |
| `POST /internal/conversation-forks` | per-caller service identity | 按用户/tenant/workspace 复制当前不可变文档和文件引用，返回文档/路径映射 |
| `POST /internal/retrieve` | per-caller service identity | 用户作用域混合检索 |

字节上传和内容读取使用 Storage API，不经过 Knowledge 的 public media route。

会话分支在与写入/清理相同的会话锁内检查源和目标 tombstone、目标为空以及资源 scope。
复制文档为不再索引的只读 artifact 快照；原 source 文档继续独立保留。副本沿用精确的
Asset/revision，生成新的文档/文件 owner 与 durable Claim intent。虚拟文件保留路径，
源文档路径映射为新 `documents/{id}`，读取仍使用 Markdown 语义投影，下载使用原字节。
正在转换的文档和未迁移的原件引用拒绝复制。Chat 负责消息分支与失败补偿。

## 数据模型

`documents` 保存业务与处理状态，核心引用为：

- `user_id` / `tenant_id` / `workspace_id` / `conversation_id`：业务归属与来源。
- `kind`：`source` 或 `artifact`；这是语义文档分类，不是存储类型。
- `asset_id` / `revision_id`：精确指向不可变 Storage revision。
- `content_md`：解析或编辑产生的可检索文本投影；原件以 Storage revision 为事实源。
- `editable_source`：可编辑文档；每次编辑先写新 Storage revision，再以版本校验切换引用。
- `ingest_status` / `index_status`：耐久转换与索引意图。

虚拟 FileStore 由以下结构组成：

- `file_entries`：以 `(user_id, conversation_id, path)` 唯一标识当前文件树，
  保存 MIME、SHA、writable、derived 及 asset_id/revision_id/size_bytes，不保存原件正文。
- `file_change_sets`：按 deliverable root 保存 baseline SHA map 与 staging 元数据。
- `file_change_set_entries`：同一 delivery 的候选文件，clean check 后整体 promote。

用户上传的 source 文档以只读 `sources/*` 路径投影进 `list/read/search`。发布时按
root 获取 advisory lock 并核对 baseline，因此不同 root 可并行，同 root 的过期写入
不能覆盖当前快照。

## Storage 生命周期协作

上传先进入 Storage 并得到 immutable revision。Knowledge 在本地业务事务中同时写入
文档和 Claim intent；独立 relay 以幂等的 prepare/activate/release 调用推进平台 Claim。
因此数据库提交与跨服务调用之间不存在悬空引用窗口，重启和至少一次投递也不会改变
最终所有权。删除文档只释放 Claim，物理删除由 Storage 的 retention、GC 和 deletion
fencing 决定。

## 与 Chat 和 Executor 的关系

- Chat 通过生成的 transport client 读取 source、管理 current tree/change set；它不
  读取 Knowledge 数据库。
- 删除会话时，Chat 通过事务 outbox 请求 Knowledge 幂等清理该会话生成的 artifact、
  虚拟文件树与 staged media，并释放关联 Storage Claims。用户独立拥有的 source 保留。
- Knowledge 保存 conversation tombstone，拒绝已删除会话的迟到生成写入。
- Executor 只提供 workflow replay、retry 和 recovery，不持有 Knowledge 数据。

## 耐久文档处理

`documents.ingest_status/index_status` 是转换和索引的 durable intent。Knowledge 用
固定大小批次把 pending 文档提交为 Executor 的 `knowledge-document-process` task；
owner ref 包含内容版本，因此多副本扫描与重启重试不会重复启动同一版本。Workflow
依次调用 Knowledge 拥有的幂等 convert/index command。没有 embedding provider 时仍
写入 `embedding=NULL` 的 lexical chunks，保证 pg_trgm sparse-only 检索可用。

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

## 存量文件迁移

运行代码只有 Storage 引用读写一套实现。旧 `content` 列只供离线迁移读取，应用不映射、
不回退读取该列。缺少引用会明确拒绝访问。Knowledge 的解析文本与搜索索引继续由本服务拥有。

部署前停止 Knowledge/Chat/Executor 的文件写入，先启动 Storage，执行
`just migrate-up knowledge` 扩展引用字段。设置 `KNOWLEDGE_DATABASE_URL`、
`STORAGE_SERVICE_URL`、`INTERNAL_API_TOKEN`（Knowledge workload identity），运行：

```bash
just backfill-knowledge-storage
just backfill-knowledge-storage --verify
```

任务由 Knowledge 拥有，只访问自己的数据库，通过 Storage HTTP 上传并逐字节校验 SHA-256。
主键分页、引用字段与稳定幂等键支持中断重跑；CAS 拒绝覆盖并发修改。引用和 Claim intent
在同一事务提交，重跑也补投未完成 Claim。确认持久引用后清空旧文件正文；文档可检索文本保留。
缺少 tenant/workspace 的旧记录必须先修复归属，不能猜测归属或静默跳过。对账通过后启动新应用。
旧签名 URL、原件代理与双读路径不再提供；物理 schema 收缩另用版本化迁移完成。
