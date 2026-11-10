# chat service

TypeScript / Hono / Vercel AI SDK v7 Agent Runtime。业务状态存于 PostgreSQL；Chat 自己登记会话文件/Plan 的不可变 Asset revision，Knowledge 持有语义文档，Storage 持有字节。运行时由 `@hono/node-server` 托管；用 `tsx` 直接运行 TypeScript 源码（`@backend/transport-ts` 是源码包，tsc 产物会留下无法解析的裸 import），`tsc --noEmit` 仅做类型检查。

## 配置

本地启动从服务目录加载 `.env`；修改后需重启 Chat 进程（Overmind 使用 `overmind restart svc-chat`）。 `just up` 负责基础设施和数据库迁移，不重启本地 Chat 进程。网页搜索至少需要 `EXA_API_KEY` / `TAVILY_API_KEY` 之一，Exa 主用、Tavily 回退。Single-VPS 从部署环境注入，K8s 从 `chat-secrets` 注入，不读取本机服务目录的 `.env`。

## API

- `POST /conversations/{id}/agents/run/stream`：启动一次 ToolLoopAgent UI stream。请求保留 SDK message，并显式携带 `trigger`、可选 `messageId`、`expected_revision` 和稳定 `request_id`；编辑、重新生成和工具续跑分别绑定其目标，不能由最后一条消息猜测。
- `GET /conversations/{id}/agents/run/stream`：恢复当前活动 UI stream；无活动流返回 204
- `GET /conversations/{id}/agents/runs/{runId}/trace`：读取步骤与 tool trace
- `POST /conversations/{id}/history/select`：以 `expected_revision` CAS 选择已存在候选的 leaf，只改变权威历史，不创建 run 或执行工具。
- `POST /conversations/{id}/sources/{sourceId}/delivery`：仅当来源出现在当前会话 journal、带受支持 resolver 且仍属于当前 tenant/workspace 时，返回短期受权访问能力；前端只在明确点击中申请，避免把 capability 放进持久消息或预取链路。
- `POST /conversations/{id}/forks`：按 `message_id` 创建新会话分支。仅接受本用户、tenant/workspace 内已结束的 assistant 回复；原会话有活动 run 时返回 409。分支复制到指定回复为止的历史、Knowledge 文档快照，以及创建时 Chat 当前 `conversation_files` 的不可变 Asset/revision 引用。它不是历史文件回滚；不复制 run、provider response chain、画布绑定或自动执行请求。未终态/preliminary 工具在副本中关闭，未完成 todo 取消；已失败消息保持 failed。外部视频任务只展示历史，审批仍在原会话。Chat 先持久化已占用的 cleanup outbox intent，Knowledge 在本地事务内复制文档引用与独立 Claim intent；最后 Chat 在一个发布事务中验证清理租约、复制本地 file rows/Claim intents、重写消息中的 document/file id、写入分支并删除补偿 intent。进程中断或外部复制失败时复用现有清理 relay；租约已被接管则拒绝发布。源会话的 `run_revision` 在每次成功插入 run lease 时由数据库触发器递增。分支发布事务以 `FOR NO KEY UPDATE` 锁住源会话并核对复制前的修订号；复制期间启动过 run（即使已结束）则返回 409，外部副本交由 outbox 清理。先取得发布锁时，run 启动等待该短事务完成；Knowledge 调用仍在 Chat 数据库事务外。
- 会话 CRUD 与文档 facade 路由保持不变
- 删除会话时，本地事务同时写入 artifact cleanup outbox；HTTP 204 不等待 knowledge 或对象存储。后台 relay 至少一次投递幂等清理命令，失败在重启后继续重试。

## Agent runtime

Chat 升级依次应用追加迁移 `v1.0.0.1` 至 `v1.0.0.4` （`just migrate-up chat`）。这些步骤依次增加 run revision/lease 触发器、history revision/selected leaf/消息分支和 run operation binding、完整逻辑请求指纹，以及 Chat-owned `conversation_files`、`asset_claim_intents` 和 `active_plan_file_id`。相同 `request_id` 只有完全一致的重试能够复用 run；文件发布以稳定 idempotency key 注册不可变 revision。迁移不重置消息或 run；应用回退保留扩展 schema，不提供自动 DOWN。并发集成测试使用隔离且已迁移的数据库：`CHAT_FORK_TEST_URL=<isolated-postgres-url> just test backend/chat src/application/conversation-fork.postgres.ts`。缺少该配置时失败，不作为跳过或通过；默认单元测试不依赖数据库。Chat journal 与 Redis transport 的基础设施测试需要显式启用： `CHAT_POSTGRES_INTEGRATION=1 just test backend/chat src/application/agent/runs/repository.integration.test.ts` 和 `CHAT_REDIS_INTEGRATION=1 just test backend/chat src/application/agent/streams/service.integration.test.ts`。它们使用已迁移的本地 Chat 数据库/Redis、只创建唯一前缀记录并清理；默认套件中的 skip 不构成通过证据，发布验证必须单独执行启用后的命令。

- 主链使用 `ToolLoopAgent`。服务端 run controller 的 AbortSignal 贯穿模型、web search、图片分析和 artifact 内部模型调用；只有显式 Stop/cancel 才终止生成。
- Context 以 PostgreSQL UIMessage journal 为权威。OpenAI Responses 在有效输入预算的 80% 水位启用原生 server compaction，覆盖同一 ToolLoopAgent run 内的多步增长；stored continuation 只连接同 provider/model 且紧邻当前输入的 journal 输出。每个 run 结束后记录最后一步 input usage，达到水位或 usage 缺失时，下一次 run 不再续接旧 `previous_response_id`，而是从完整 journal 增量摘要旧前缀、保留 recent tail 后建立新 lineage。Ark 等未验证兼容 dialect 不接收 OpenAI 专有 `context_management`；DeepSeek 始终本地重放。断链重放删除 opaque provider compaction item 和 stored item reference。摘要失败会阻止本次生成且不推进 coverage，不以省略占位符静默丢历史；已完成压缩批次的 usage 仍会记入失败 run。
- AI SDK 原生 UIMessage SSE 由 Redis 临时保存。刷新、网络断开或切换会话只断开 subscriber，GET 可从头重放活动 run；完成后清除 active 标记并由 PostgreSQL 消息接管。
- 历史选择、删除和 run claim 在 conversation 锁下识别 lease：只有未过期且 run 仍为 `running/cancel_requested` 才阻止 mutation；终态、缺失或过期 lease 在事务内回收，过期 active run 收口为 `interrupted`。selected leaf 与消息图在同一事务中顺序读取，不跨连接拼接不一致快照。
- subscriber 断开会中断对应的 Redis blocking read 并关闭 duplicate connection，不影响继续写 Redis Stream 的 run producer。
- 该能力不恢复 ToolLoopAgent 的进程栈：服务进程丢失后仍依靠已持久化消息、plan snapshot 和 artifact 状态创建新 run。
- `ask_user` 没有服务端 execute；一次调用以稳定语义 ID 批量携带当前所有独立问题，客户端一次性回填结构化 `answers` 后由 `addToolOutput` 发起下一次 run；依赖前序答案的问题才使用后续 continuation。Middleware 将 `ask_user` 保持为独占调用，并把 `load_skill` 作为 batch barrier；独立只读工具仍可同 step 并发。Markdown、HTML、图片和视频生成调用按计划顺序串行，不存在通用 delegated-file 批次旁路。
- assistant UIMessage 在 stream end（包括 abort 的部分输出）持久化；工具终态、消息、run 状态、selected leaf 和 lease 删除在同一个幂等数据库事务收口。关键持久化失败使响应失败且事务整体回滚；独立 trace 写入失败不影响用户流。
- 主动 Stop 会在落库前把所有未终态/preliminary tool part 收口为官方 `output-error`，并把未完成 todo 改为 `cancelled`；取消接口等待本地 run finalizer，因而重新进入会话不会把已取消卡片恢复成 loading。
- Plan mode 用 Bash 创建完整 `*-plan.md`，再通过 `save_sandbox_file` 发布；Chat 将其登记为 `kind=plan` 并更新 `active_plan_file_id`。

## Files

- Bash 操作真实的 run 工作区，支持普通文件与二进制文件的创建、读取、修改、删除、转换和验证。底层 SandboxSession 支持进程生命周期与增量输出，但模型侧只暴露一个等待终态并响应 Stop 的 `bash` 工具。
- `save_sandbox_file` 显式上传文件至 Asset，并在当前会话注册不可变快照。保存前的工作文件仅存在于沙箱；run 结束后销毁。原始附件和已保存成果可在后续 run 重新导入。
- user `file` 只接受当前会话的稳定 Knowledge 文档引用，不接受客户端提供的 `providerReference`；providerReference 仅保留服务端/provider 产生的 assistant 语义。模型新产生的 `file/reasoning-file` 先上传 Storage，再登记为 Chat conversation file。图片进入模型上下文时经受权 Storage 派生最长边 1536 的输入，journal 不改写为 base64。
- `load_conversation_files` 将原始文档附件与 Chat-owned 会话文件/Plan 导入只读 `sources/` 并返回精确路径，也支持重新导入本轮其他工具刚发布的文件。发现和读取统一使用 Bash。
- 普通文件全部由主 Agent 通过 Bash 编写、验证后逐个 `save_sandbox_file` 发布。HTML 是完整浏览器文件，不经过 compiler/block/verification 状态机。
- 运行隔离、出口策略、回收与部署见 [Sandbox](sandbox.md)。
- HTML 类型与生成规模正交。报告、动态 Dashboard、H5 游戏、模拟器和互动课件均可使用完整 JavaScript/DOM/Canvas/SVG/WebGL/媒体能力。前端使用普通 iframe 预览，不通过 sandbox allow-list、Executor sanitizer 或格式白名单裁剪能力。
- 每次 `save_sandbox_file` 都创建新的不可变会话文件快照；编辑旧产物时先导入、复制到 work、修改和验证，再发布新 file id。主 Agent 按顺序逐个启动 Markdown、HTML、图片和视频交付物。
- `create_video_production` 的产品语义是“创建视频制片任务”，不是同步生成最终视频。初步分镜与成本投影持久化并派发给 Executor Workflow 后，工具携带 `production_id` 完成，对应 video todo 也立即完成。此后由同一个 Workflow 独立等待审批并推进生成、Take 审核、合成与发布；后续串行的 HTML/图片无需等待完整视频生命周期。返回边界依据持久化 stage，而不是可能在两次轮询间被快速审批跨过的瞬时 `awaiting_approval` 状态。
- 用户取消 chat run 会通过 tool AbortSignal 取消当前前台等待的视频 Executor task；进程故障不会自动取消 durable task。Sandbox 中未发布的临时文件随 run 回收，已发布的不可变快照不受影响。

## Tool contracts

- `tools/builtins/` 按 search/files/planning/interaction/media/memory 分类，提供给模型的 ToolSet 仍为扁平结构。
- `manifest.ts` 统一生成 mode availability、审批策略、Plan capability projection 和前端 `toolMetadata.agent.uiKind`。
- Plan mode 可用只读研究/Skill 工具以及 Sandbox Bash/load；唯一允许的写入是用 `save_sandbox_file` 发布完整 Plan，同时获得正常执行能力摘要但不能提前执行最终产物。
- 用户从 Plan 卡片执行时，`data-plan-execution` 携带稳定 `file_id`；sandbox 将该不可变 Plan 导入 `/workspace/sources/saved/<file_id>/`，runtime contract 要求用 Bash 完整读取后再开始 todo 或生成。用户仅用自然语言要求执行 Plan 时，由模型先调用 `load_conversation_files` 并用 Bash 发现 `*-plan.md`；多个 Plan 时通过 `ask_user` 提问，不增加专用 Plan 读取 Tool、Harness 选择器或动态候选注入。
- 每个 run 解析本轮使用的权威引用：显式 Plan `file_id` 绑定 Chat 中选中的不可变 Asset revision；激活的 Skill（含 client-tool continuation）从 Admin 读取最新发布版本，其他 instruction/config 引用从其 owner 读取。历史 search tool 结果属于证据，默认复用；只有用户明确要求重新检索或最新信息且旧证据不足时才再次搜索。
- Admin Skill 只广告已发布快照的名称与描述；`load_skill` 读取已发布 `SKILL.md`，`read_skill_file` 再按需读取该快照列出的 references/templates/ scripts 等文本资源，草稿树永不进入运行时。

跨服务调用必须经过 `@backend/transport-ts`；provider 配置归 Admin，语义文档归 Knowledge，会话文件元数据与 Claim intent 归 Chat，durable bytes 归 Storage，临时命令执行归 Sandbox，已注册长任务归 Executor。当前决策见 [Agent runtime](../ADR/agent-runtime.md)、[文件与 Asset](../ADR/files-and-assets.md) 与 [耐久执行](../ADR/durable-execution.md)。
