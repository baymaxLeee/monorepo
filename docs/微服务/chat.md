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
- `ask_user` 没有服务端 execute；一次调用以稳定语义 ID 批量携带当前所有独立问题，
  客户端一次性回填结构化 `answers` 后由 `addToolOutput` 发起下一次 run；依赖前序答案的
  问题才使用后续 continuation。Plan mode 保留 provider 并行 tool calls，但模型
  middleware 会过滤与 `ask_user` 同 step 的 `write_plan`/`update_plan`，使计划只能在
  用户回答后的 continuation 落库；搜索、读取等其他独立工具仍可同 step 并发。
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
- HTML typed outline 在 fan-out 前统一生成全局 narrative 与逐 block layout intent。
  chat 只无损传递用户要求、事实、数据、顺序、视觉约束和禁止项，不自行设计分页、模块
  合并拆分、layout、narrative、图表位置或主题。`page_count` 是唯一 typed 数量硬信号，
  仅在用户明确要求精确页数时传递；未传时 executor 根据 brief 的内容复杂度决定
  页数，brief 含显式模块清单时保序、保 scope、不得遗漏。模型未遵守显式数量时只做
  一次条件式结构化 repair，仍失败才使用精确页数的 deterministic fallback。
- 前端通过 task progress UIMessage stream 展示细粒度进度；tool 自身轮询 executor
  terminal state，前者只负责 UX，后者才是完成信号。
- `create_video_production` 的产品语义是“创建视频制片任务”，不是同步生成最终视频。初步分镜与
  成本投影持久化并派发给 Executor Workflow 后，工具携带 `production_id` 完成，对应
  video todo 也立即完成。此后由同一个 Workflow 独立等待审批并推进生成、Take 审核、
  合成与发布；与它并行的 HTML/图片不等待完整视频生命周期。返回边界依据持久化 stage，
  而不是可能在两次轮询间被快速审批跨过的瞬时 `awaiting_approval` 状态。
- executor compiler 统一提供版本化响应式 shell、主题 tokens、Grid/Flex primitives、
  CSP、CSS 清洗和 ECharts hydration；HTML block 只负责语义内容与有限的 scoped 构图。
  block 内局部 ID 会按 `page-N--local-id` 确定性命名空间化并同步重写 CSS、fragment
  link 与 ARIA IDREF；模型误写的 compiler-owned `page-N` 声明会被移除。
- `edit_file` 从 knowledge 读取最新 immutable revision，复用未改 block，只生成受
  影响 block，并在同一个 document 下发布新 revision（同样委派给 executor）。
  manifest v4 持久化 narrative/layout；旧 revision 编辑时补静态默认，但不新增规划
  LLM 调用。当前 change request 优先，既有 HTML 保持未改内容的事实来源，历史规划仅作
  提示；原有 BlockStrategy 与目标范围不变。
- `write_file`/`edit_file` 的 HTML 终态是 compile/publish 结果。成功后 ToolLoop
  的 `prepareStep` 只开放并强制 Chat 本地 `validate_html`；无硬错误即结束，有可定位
  硬错误则按 `edit_file` → `validate_html` 修复复验。
  Executor 不提供校验路由或校验 Workflow。
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
  `write_file`、`generate_images`、`create_video_production`，但不能提前执行。
- 用户从 Plan 卡片执行时，`data-plan-execution` 携带明确文档 ID；ToolLoop 只开放并
  强制调用现有 `read_file`，直到连续分片覆盖 Plan 最新全文，之后才开放
  `update_todos` 和生成工具。用户仅用自然语言要求执行 Plan 时，由模型先调用
  `list_files` 自行发现；多个 Plan 时通过 `ask_user` 提问，不增加专用 Plan 读取 Tool、
  Harness 选择器或动态候选注入。
- 每个 run 对本轮使用的可变权威引用重新取最新快照：Plan 从 Knowledge 读取，激活的
  Skill（含 client-tool continuation）从 Admin 读取最新发布版本，其他 instruction/
  config 引用从其 owner 读取。历史 search tool 结果属于证据，默认复用；只有用户明确
  要求重新检索或最新信息且旧证据不足时才再次搜索。
- Admin Skill 只广告已发布快照的名称与描述；`load_skill` 读取已发布
  `SKILL.md`，`read_skill_file` 再按需读取该快照列出的 references/templates/
  scripts 等文本资源，草稿树永不进入运行时。

跨服务调用必须经过 `@backend/transport-ts`；provider 配置归 admin，artifact 存储
归 knowledge，长任务执行归 executor。架构决策见 ADR-0011、ADR-0012、ADR-0013、
ADR-0015。
