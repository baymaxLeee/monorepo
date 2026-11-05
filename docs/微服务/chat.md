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
- 删除会话时，本地事务同时写入 artifact cleanup outbox；HTTP 204 不等待 knowledge
  或对象存储。后台 relay 至少一次投递幂等清理命令，失败在重启后继续重试。

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
  middleware 会过滤与 `ask_user` 同 step 的 plan-mode `write_plan`，使计划只能在
  用户回答后的 continuation 落库；搜索、读取等独立只读工具仍可同 step 并发。正常模式
  的 Markdown、HTML、图片和视频生成调用按计划顺序串行，只有 `delegate_tasks`
  会在一次调用内部并发生成多个独立完整文件。
- assistant UIMessage 在 stream end（包括 abort 的部分输出）持久化；run trace 写入
  失败不能影响用户流。
- 主动 Stop 会在落库前把所有未终态/preliminary tool part 收口为官方
  `output-error`，并把未完成 todo 改为 `cancelled`；取消接口等待本地 run finalizer，
  因而重新进入会话不会把已取消卡片恢复成 loading。
- `write_plan` 在 Plan mode 保存完整 `*-plan.md` 并更新 `active_plan_path`。

## Files

- Bash 操作真实的 run 工作区，支持普通文件与二进制文件的创建、读取、修改、删除、
  转换和验证。`write_stdin` 继续长命令、轮询增量输出或发送交互输入。
- `save_sandbox_file` 显式上传文件至 Asset，并在当前会话注册不可变快照。保存前的
  工作文件仅存在于沙箱；run 结束后销毁。原始附件和已保存成果可在后续 run 重新导入。
- `list_conversation_files` / `read_conversation_file` 查询持久会话资源及旧文件树；
  `load_conversation_files` 返回沙箱内精确路径，也支持重新导入本轮其他工具新增的文件。
- `delegate_tasks` 保留独立完整文件的 durable 批次生成与原子发布。普通单文件由
  主 Agent 通过 Bash 编写、验证后发布；没有 HTML compiler/block/verification 状态机。
- 运行隔离、出口策略、回收与部署见 [Sandbox](sandbox.md)。
- HTML 类型与生成规模正交。报告、动态 Dashboard、H5 游戏、模拟器和互动课件均可
  使用完整 JavaScript/DOM/Canvas/SVG/WebGL/媒体能力；direct 与 delegated 的差异
  只是谁 materialize 文件，不改变浏览器能力。前端使用普通 iframe 预览，不通过
  sandbox allow-list、Executor sanitizer 或格式白名单裁剪能力。
- change set baseline、同路径 mutation queue 与发布 advisory lock 均以 deliverable
  root 为粒度；主 Agent 仍按顺序逐个启动 Markdown、HTML、图片和视频交付物。
- `create_video_production` 的产品语义是“创建视频制片任务”，不是同步生成最终视频。初步分镜与
  成本投影持久化并派发给 Executor Workflow 后，工具携带 `production_id` 完成，对应
  video todo 也立即完成。此后由同一个 Workflow 独立等待审批并推进生成、Take 审核、
  合成与发布；后续串行的 HTML/图片无需等待完整视频生命周期。返回边界依据持久化 stage，
  而不是可能在两次轮询间被快速审批跨过的瞬时 `awaiting_approval` 状态。
- 用户取消 chat run 会通过 tool AbortSignal 取消当前前台等待的 executor task；进程
  故障不会取消 durable task。委派批次取消或失败时 Chat discard 未发布 change set，
  当前快照不受影响。

## Tool contracts

- `tools/builtins/` 按 search/files/planning/interaction/media/memory
  分类，提供给模型的 ToolSet 仍为扁平结构。
- `manifest.ts` 统一生成 mode availability、审批策略、Plan capability projection
  和前端 `toolMetadata.agent.uiKind`。
- Plan mode 只加载研究、交互和计划工具，同时获得执行能力摘要，因此能规划
  `delegate_tasks`、`generate_images`、`create_video_production`，但不能提前执行。
- 用户从 Plan 卡片执行时，`data-plan-execution` 携带稳定 path；ToolLoop 只开放并
  强制调用 `read_conversation_file`，直到连续行区间覆盖 Plan 最新全文，之后才开放
  `update_todos` 和生成工具。用户仅用自然语言要求执行 Plan 时，由模型先调用
  `list_conversation_files` 自行发现；多个 Plan 时通过 `ask_user` 提问，不增加专用 Plan 读取 Tool、
  Harness 选择器或动态候选注入。
- 每个 run 对本轮使用的可变权威引用重新取最新快照：Plan 从 Knowledge 读取，激活的
  Skill（含 client-tool continuation）从 Admin 读取最新发布版本，其他 instruction/
  config 引用从其 owner 读取。历史 search tool 结果属于证据，默认复用；只有用户明确
  要求重新检索或最新信息且旧证据不足时才再次搜索。
- Admin Skill 只广告已发布快照的名称与描述；`load_skill` 读取已发布
  `SKILL.md`，`read_skill_file` 再按需读取该快照列出的 references/templates/
  scripts 等文本资源，草稿树永不进入运行时。

跨服务调用必须经过 `@backend/transport-ts`；provider 配置归 admin，虚拟文件存储
归 knowledge，临时命令执行归 sandbox，长任务执行归 executor。当前决策见 [Agent runtime](../ADR/agent-runtime.md)、[文件与 Asset](../ADR/files-and-assets.md) 与 [耐久执行](../ADR/durable-execution.md)。
