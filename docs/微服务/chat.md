# chat service

TypeScript / Hono / Vercel AI SDK v7 Agent Runtime。业务状态存于 PostgreSQL；
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
  subscriber，GET 可从头重放活动 run；完成后清除 active 标记并由 PostgreSQL 消息接管。
- subscriber 断开会中断对应的 Redis blocking read 并关闭 duplicate connection，
  不影响继续写 Redis Stream 的 run producer。
- 该能力不恢复 ToolLoopAgent 的进程栈：服务进程丢失后仍依靠已持久化消息、plan
  snapshot 和 artifact 状态创建新 run。
- `ask_user` 没有服务端 execute；客户端 `addToolOutput` 后发起下一次 run。
- assistant UIMessage 在 stream end（包括 abort 的部分输出）持久化；run trace 写入
  失败不能影响用户流。
- 主动 Stop 会在落库前把所有未终态/preliminary tool part 收口为官方
  `output-error`，并把未完成 todo 改为 `cancelled`；取消接口等待本地 run finalizer，
  因而重新进入会话不会把已取消卡片恢复成 loading。
- `write_plan` 创建 plan，`update_plan` 以 CAS tool output 保存后续完整 snapshot；
  下一 run 注入最新 active plan，冲突不会中断 SSE。

## Artifact

- Markdown 与 HTML 统一由 `write_file` 创建、`edit_file` 更新。
- **Markdown** 同步：一次 `streamText` 直接在这次 tool execute 内完成，无需持久化
  执行状态。
- **HTML 委派给 `executor` 服务并前台等待**（ADR-0015）：tool execute 先流式返回
  `{ status, task_id }`，随后等待 terminal result，避免同一 artifact 出现竞争编辑。typed outline、4 路
  有界并发 block 生成、allowlist sanitize、compile、发布全部发生在 executor
  的 `html-artifact` TaskType（真正的 Workflow DevKit，可跨进程崩溃/重启存活）
  里，chat 不再传输 HTML 正文，也不再自己跑 worker pool。
- 前端通过 task progress UIMessage stream 展示细粒度进度；tool 自身轮询 executor
  terminal state，前者只负责 UX，后者才是完成信号。
- executor compiler 统一提供版本化响应式 shell、主题 tokens、Grid/Flex primitives、
  CSP、CSS 清洗和 ECharts hydration；HTML block 只负责语义内容与有限的 scoped 构图。
  block 内局部 ID 会按 `page-N--local-id` 确定性命名空间化并同步重写 CSS、fragment
  link 与 ARIA IDREF；模型误写的 compiler-owned `page-N` 声明会被移除。
- `edit_file` 从 knowledge 读取最新 immutable revision，复用未改 block，只生成受
  影响 block，并在同一个 document 下发布新 revision（同样委派给 executor）。
- `write_file`/`edit_file` 的 HTML 终态携带 executor 生成的完整验证报告。
  `html_validate` 每次读取 Knowledge 当前 HTML 并调用 executor 的同步内部校验接口，
  返回 error/warning code、block、selector、evidence 和修复建议；模型可据此调用
  `list_artifact_blocks` + `edit_file` 后再次校验。chat 不复制 validator，也不执行
  宿主机 shell 或不可信 HTML。静态校验不走 durable Workflow；生成和编译修复仍走。
- 用户取消 chat run 会通过 tool AbortSignal 取消当前前台等待的 executor task；进程
  故障不会取消 durable task。
- executor 先持久化并通知 task `cancelled`，再取消 Workflow，并按 task type 补偿
  外部状态：HTML 取消 Knowledge generation，video 删除已记录的 Ark segment task。

## Tool contracts

- `tools/builtins/` 按 search/files/planning/interaction/artifacts/media/memory
  分类，提供给模型的 ToolSet 仍为扁平结构。
- `manifest.ts` 统一生成 mode availability、审批策略、Plan capability projection
  和前端 `toolMetadata.agent.uiKind`。
- Plan mode 只加载研究、交互和计划工具，同时获得执行能力摘要，因此能规划
  `write_file`、`generate_images`、`generate_video`，但不能提前执行。

跨服务调用必须经过 `@backend/transport-ts`；provider 配置归 admin，artifact 存储
归 knowledge，长任务执行归 executor。架构决策见 ADR-0011、ADR-0012、ADR-0013、
ADR-0015。
