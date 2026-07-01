# chat service

TypeScript / Hono / Vercel AI SDK v7 Agent Runtime。业务状态存于 MySQL；
文档和 artifact 由 knowledge 持久化。运行时由 `@hono/node-server` 托管；用 `tsx`
直接运行 TypeScript 源码（`@backend/transport-ts` 是源码包，tsc 产物会留下无法
解析的裸 import），`tsc --noEmit` 仅做类型检查。

## API

- `POST /conversations/{id}/agents/run/stream`：启动一次 ToolLoopAgent UI stream
- `GET /conversations/{id}/agents/run/stream`：恢复当前活动 UI stream；无活动流返回 204
- `GET /conversations/{id}/agents/runs/{runId}/trace`：读取步骤与 tool trace
- 会话 CRUD 与文档 facade 路由保持不变

## Agent runtime

- 主链使用 `ToolLoopAgent`。服务端 run controller 的 AbortSignal 贯穿模型、web
  search、图片分析和 artifact 内部模型调用；只有显式 Stop/cancel 才终止生成。
- AI SDK 原生 UIMessage SSE 由 Redis 临时保存。刷新、网络断开或切换会话只断开
  subscriber，GET 可从头重放活动 run；完成后清除 active 标记并由 MySQL 消息接管。
- 该能力不恢复 ToolLoopAgent 的进程栈：服务进程丢失后仍依靠已持久化消息、plan
  snapshot 和 artifact 状态创建新 run。
- `ask_user` 没有服务端 execute；客户端 `addToolOutput` 后发起下一次 run。
- assistant UIMessage 在 stream end（包括 abort 的部分输出）持久化；run trace 写入
  失败不能影响用户流。
- `write_plan` 创建 plan，`update_plan` 以 CAS tool output 保存后续完整 snapshot；
  下一 run 注入最新 active plan，冲突不会中断 SSE。

## Artifact

- Markdown 与 HTML 统一由 `write_file` 创建、`edit_file` 更新。
- **Markdown** 同步：一次 `streamText` 直接在这次 tool execute 内完成，无需持久化
  执行状态。
- **HTML 委派给 `executor` 服务，非阻塞**（ADR-0015）：tool execute 立刻返回
  `{ status, task_id }`，主 ToolLoopAgent 不等待生成完成。typed outline、4 路
  有界并发 block 生成、allowlist sanitize、compile、发布全部发生在 executor
  的 `html-artifact` TaskType（真正的 Workflow DevKit，可跨进程崩溃/重启存活）
  里，chat 不再传输 HTML 正文，也不再自己跑 worker pool。
- 前端通过 `GET /conversations/{id}/tasks/{taskId}`（代理到 executor）按
  `task_id` 单独轮询进度，取代旧版"列出会话所有未完成任务"的 `/artifact-jobs`。
- HTML block 自行生成 scoped CSS、主题、布局与图表 option；executor 的 compiler
  只提供安全壳、CSP、网络型 CSS 清洗和 ECharts hydration，不按
  document/presentation/dashboard 注入固定视觉模板。
- `edit_file` 从 knowledge 读取最新 immutable revision，复用未改 block，只生成受
  影响 block，并在同一个 document 下发布新 revision（同样委派给 executor）。
- `run_command` 只提供 HTML 结构与内部链接检查，不执行宿主机 shell，留在 chat
  本地（不需要模型调用，不需要持久化执行状态）。
- 取消一次 chat run **不会**级联取消它已经派发出去的 executor task——那是设计上
  独立于当前 run/turn 存活的后台工作，语义上等同 Cursor/Codex 的后台 agent。

跨服务调用必须经过 `@backend/transport-ts`；provider 配置归 admin，artifact 存储
归 knowledge，长任务执行归 executor。架构决策见 ADR-0011、ADR-0012、ADR-0013、
ADR-0015。
