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
- 大型 HTML 在一次 tool execute 内完成 typed outline、4 路有界并发 block 生成、
  allowlist sanitize、compile 和完整发布；主 Agent 不传输 HTML 正文。
- HTML block 自行生成 scoped CSS、主题、布局与图表 option；compiler 只提供安全壳、
  CSP、网络型 CSS 清洗和 ECharts hydration，不按 document/presentation/dashboard
  注入固定视觉模板。
- `edit_file` 从 knowledge 读取最新 immutable revision，复用未改 block，只生成受影响
  block，并在同一个 document 下发布新 revision。
- `run_command` 只提供 HTML 结构与内部链接检查，不执行宿主机 shell。
- 主 Agent 等待高层 tool 完成，因此无需单独 server、child agent 或 workflow。

跨服务调用必须经过 `@backend/transport-ts`；provider 配置归 admin，artifact 归
knowledge。架构决策见 ADR-0011、ADR-0012、ADR-0013。
