# Canvas

Canvas 是 Go 服务，监听 `8012`，拥有项目、画布、节点、素材、生成任务和用量记录；
业务元数据归 `canvas` PostgreSQL 数据库所有。媒体 bytes 由 Storage 持久化，
Canvas 自有的 durable 任务由同一镜像的 `worker` 进程领取，模型与运营配置从
`admin` 获取，Canvas 通过声明的 gRPC binding 调用 Admin 和 Storage。

## 运行配置

本地配置源是 `apps/backend/services/canvas/.env.example`。`staging`、`single-vps`
和 `production` 不允许使用本地默认值，必须显式提供数据库、Redis、内部令牌、两个
服务 binding 以及 `PUBLIC_GATEWAY_URL`。后者必须是浏览器可访问的 Gateway origin；
不能写容器内部地址或 `localhost`。`production` 要求 HTTPS。

Canvas 的 `/livez` 只表示进程存活；`/readyz` 和 `/healthz` 同时检查 PostgreSQL 与
Redis。K8s 的 readiness probe 必须使用 `/readyz`。

同一 Canvas 镜像包含 `/canvas-server` 与 `/canvas-worker` 两个独立二进制入口。
`canvas-server` 只处理 HTTP、同步事务和 durable intent 写入；`canvas-worker` 处理本地
poll schedules、async dispatches、deletion jobs、Asset claim relay、配额收敛与定时清理。
两者复用 domain、application 和 infrastructure，且共享 Canvas 数据库，但使用独立的
Deployment、容器入口、资源、探针和扩缩容生命周期。

## Agent MCP surface

Canvas server 在 `/mcp` 挂载官方 Go MCP SDK 的 Streamable HTTP handler。每次请求只信任 Runtime
注入的 user/tenant/workspace/role 以及 manifest binding 映射出的 project/canvas headers，并复用
Canvas application access checker；tool annotations 不参与授权。当前 inventory 严格只有只读
`get_canvas_context`，没有节点更新、节点生成或故事板提交。Runtime 不保留 Canvas gRPC tool client；
endpoint、schema、bindings 与 trust 由 Admin immutable release 管理，见
[Agent plugin ADR](../ADR/agent-plugins.md)。

## 媒体链路

浏览器通过 Gateway 直接流式上传到 `/api/storage-server/assets`，再把 immutable
`asset_id + revision_id` 注册到 Canvas 的项目、画布、节点或素材业务记录。Canvas
在同一业务事务写 durable Claim intent，异步 relay 以 generation + CAS 保护地投递到
Asset。封面、归档、生成输入与产物都遵循同一模型，不再经过 Knowledge object API。
返回给浏览器或外部 provider 的短期 URL 由 Asset delivery capability 签发。

## Canvas 状态复制

Studio 保留 HTTP `getCanvasGraph` 作为首次加载及恢复的大快照入口，使用单一 Canvas SSE 传递后续增量。
节点、边、生成/匹配任务、文本 checkpoint、审核、故事板会话、画布元信息与导出记录都进入同一事务日志。
前端正式状态仅从顶层投影派生；命令回执只等待 cursor，不回填正式图，也不触发成功后的整图刷新。
协议、失败恢复与验证命令见 [Canvas events](../../schemas/streaming/canvas-events.md)，设计见 [ADR-0077](../ADR/0077-canvas-event-projection.md)。

事件表和投影触发器属于当前 `v1.0.0/v1.0.0.0.up.sql` 重装基线。该基线不提供旧 Canvas
数据库的保留数据升级路径；部署前必须重建 Canvas 应用数据。后续已发布 schema 变更仍按
[数据库迁移规范](../开发规范/database-migrations.md) 追加迁移。
