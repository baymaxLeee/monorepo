# Canvas snapshot + SSE

Canvas 合同的生成源是 `apps/backend/services/canvas/internal/api/contracts/canvasnode/` 与 `internal/api/openapi/spec.go`；运行根 `just sync` 生成 OpenAPI、前端客户端与 transport-ts。架构依据见 [ADR-0077](../../docs/ADR/0077-canvas-event-projection.md)。这不是 Chat UIMessage stream。

## 快照与连接

1. `GET /api/canvas-server/projects/{projectId}/canvases/{canvasId}/nodes`（客户端 `canvasGetGraph`）返回完整画布快照：`canvas`、`nodes`、`tasks`、`texts`、`archives`、`protected_node_ids` 和一致的 `cursor`。
2. `GET .../events`，请求头 `Last-Event-ID: <cursor>`，也支持 `?cursor=<cursor>`。首次连接不能省略有效 cursor；必须先读 HTTP 快照。
3. `canvas.patch` 帧的 SSE `id` 等于 JSON `cursor`。`protocol_version=3`，`base_cursor` 必须等于本地 cursor，`cursor=base_cursor+1`。完整帧验证通过后才能原子安装及推进游标。
4. 心跳没有 SSE ID。`canvas.resync_required` 也不推进游标；客户端关闭连接并重新获取 HTTP 快照。16 MiB 以上的增量同样走此路径，完整快照不通过 SSE 下发。

日志保留 24 小时；连接每 15 秒心跳，65 分钟后主动断开并由客户端重连。每次写入单独设置 10 秒 deadline，写完清除，不能让它跨越空闲心跳间隔。Gateway 对 events 取消普通请求总写入 deadline，CORS 允许 `Last-Event-ID` 并暴露 `X-Canvas-Cursor`。

## Operations

| kind | key | payload |
| --- | --- | --- |
| `canvas.upsert` | Canvas ID | `canvas` 元信息，包括 revision、默认视图与统计 |
| `node.upsert` / `node.remove` | Node ID | `node` / 无；节点包含 incoming edges，故事板节点包含私有 draft session |
| `task.upsert` / `task.remove` | TaskRun ID | `task` / 无；平台状态与 provider 观察分开 |
| `text.append` | Node ID | `text_delta`：task_run_id、content、start_offset、end_offset |
| `text.status` | Node ID | `text_status`：task_run_id、status、offset |
| `node_reviews.upsert` / `node_reviews.remove` | Node ID | `node_reviews` / 无；冻结 asset_id 与 reviews |
| `protection.add` / `protection.remove` | Node ID | 无 |
| `archive.upsert` / `archive.remove` | TaskRun ID | `archive` / 无 |

节点级操作携带 `node_id`；没有操作不表示删除。文字 offset 一律为 UTF-8 字节数，追加必须连续；新 task 的 checkpoint 从 0 开始。审核身份必须与该帧最终节点的素材身份一致，不能把旧素材审核装到新素材上。私有节点过滤后的空帧也必须安装 cursor。

## 命令及前端所有权

成功的 Canvas scoped 写请求返回 `X-Canvas-Cursor`。它是提交完成后的可见性下界，可能包含并发写入；不是第二次写入机会。页面等待顶层投影达到该 cursor 后才释放 pending/草稿。普通成功命令和 Chat 工具完成通知不得触发整图刷新或直接写正式 Store。

顶层只由 `CanvasReplica` 安装快照和 SSE patch。断线保留最后状态并重连；过期或非法数据恢复 HTTP 快照。旧快照不得覆盖已安装的新事件。卸载或 401/403/404 结束复制并拒绝未完成的回执等待。

## 验证

- `just test backend/canvas`：diff、UTF-8 checkpoint、SSE 生命周期、超大帧恢复。
- `just test backend/gateway`：events 路由流式 deadline 与跨域回执。
- `just test frontend/canvas`：原子 reducer、重放/恢复/回执及卸载。
- `just test frontend/@repo/api`：SSE 解析、reader 清理与命令回执。
- 独立 PostgreSQL 集成：先按版本顺序将 Canvas `migrations/versions/*.sql` 应用到专用测试数据库，再运行 `CANVAS_STREAM_TEST_DSN='<专用数据库 DSN>' mise exec -- go -C apps/backend/services/canvas test -race -tags=integration ./internal/infrastructure/persistence/canvasnode -run TestCanvasJournalPostgres -count=1`。不要把该 DSN 指向开发或生产数据库；测试会注入失败约束。
