# Chat Context、Plan Mode、PromptInput 与 Artifact Job 重构计划

## 目标架构

主 Chat 保持 AI SDK 7 `ToolLoopAgent`，每条用户消息创建一个新 run；不使用
`WorkflowAgent`，不恢复聊天执行栈，也不新增 Agent Server。

```text
Conversation
├── mode: normal | plan
├── canonical UIMessage history
├── context projector + incremental compaction
├── ToolLoopAgent + run lease + Stop
├── rich PromptInput (text/file/image inline tokens)
└── referenced plan/file/artifact documents

Artifact Job
├── Knowledge MySQL: job/block/revision/lease
├── Object Store: source/block/compiled artifact
├── Chat in-process bounded worker
└── crash resume; user Stop preserves completed blocks
```

## Plan Mode

- Conversation 持久化 `agent_mode: normal | plan` 和
  `active_plan_document_id`，服务端以数据库模式为准。
- Normal mode 不注册 `write_plan/update_plan`，直接回答、总结或生成最终
  Artifact；Plan mode 仅注册读取、检索、询问与计划工具，禁止最终交付和外部
  副作用。
- `*-plan.md` 是计划唯一真源，不维护第二份结构化 plan。`write_plan` 创建
  Markdown Artifact 并激活；`update_plan` 使用 document revision CAS 完整更新。
- Plan mode 自动把 active plan 最新 revision 注入上下文。Normal mode 只在用户
  点击“开始执行”或明确引用时读取该 plan；执行时不再更新计划。
- 前端 composer 提供会话级 Normal/Plan 选择器；Plan Artifact 提供预览、继续完善、
  开始执行。移除旧结构化 plan card、浏览器 item 编辑器和 synthetic completion。

## Context Engineering

- `messages` 保存完整原生 `UIMessage.parts`，仅作为展示和回放事实；新增 context
  projector 决定模型本轮看到的内容，禁止把完整历史直接传给
  `convertToModelMessages`。
- 模型上下文按顺序包含 mode instructions、当前请求、相关 memories、active/referenced
  plan、最近 Artifact job、conversation summary 和 budget 内最近 turns。
- 新增 conversation context snapshot：revision、covered message、summary、state JSON、
  estimated tokens 和 timestamps。state 只保存目标、约束、决策、已完成工作、未决问题、
  document/revision/source references，不复制 plan 或大文件正文。
- 使用 AI SDK `pruneMessages` 移除旧 reasoning、旧 tool results 和空消息；仅最近一轮
  保留完整工具过程。`read_file/web_search` 正文只在当前 run 使用。
- 接近 provider 输入预算时增量压缩最老 turns，snapshot CAS 更新；失败时确定性裁剪，
  不阻断聊天。
- Provider 配置补充 context window 与 max output；移除全局 65,536 output 假设，持久化
  step input/output/total usage。

## Rich PromptInput 与附件

- 复用现有 Tiptap `components/prompt-input`：文本、图片、文件 token 在编辑区按输入顺序
  混排，支持粘贴、拖放、文件选择、删除、图片缩略图和上传进度。
- 保留 AI Elements 的 Conversation、Message、Tool、Attachment、composer toolbar 与
  Send/Stop 视觉语言；Tiptap 只替换 textarea 输入核心，不维护第二套附件状态。
- 文件加入编辑器后立即通过 conversation document upload 写入 knowledge；token 的
  `pending/queued/storing/converting/ready/failed` 状态与进度原位更新。
- 未 ready 的 token 禁止提交；失败 token 可删除或重试。提交后仅清理成功提交的内容，
  上传/发送失败保留草稿。
- UIMessage 持久化文本和轻量 document reference，不写 blob/data URL/base64；请求正确
  填写 `document_ids`。服务端从 knowledge 校验归属并按 token 顺序投影文本与附件引用。
- 当前 turn 需要视觉理解时从对象存储读取图片并构造模型 file part；历史只保留 reference。
  Provider 支持 AI SDK 7 file upload 时可缓存 provider reference，但不是基础依赖。
- Composer 保持 IME 正确性：Enter 发送、Shift+Enter 换行、组合输入期间不提交；
  Cmd/Ctrl+Enter 也可发送。支持最大文件数、大小、MIME 和对象 URL 回收。

## Run、SSE 与 Stop

- 同一 conversation 通过 DB lease 只允许一个 active run；冲突返回
  `409 active_run_exists`。完成、失败、取消释放 lease，过期 run 标为 interrupted。
- 增加 `POST /conversations/:conversationId/agents/runs/:runId/cancel`。前端先发起
  服务端 cancel，再用 `useChat.stop()` 断开本地 subscriber。
- 服务端维护 `runId -> AbortController` 并传播到模型、搜索、读取和 Artifact job；浏览器
  request signal 不再参与组合。状态统一为 running、cancel_requested、cancelled、
  completed、failed、interrupted。
- AI SDK 原生 UIMessage SSE tee 到 Redis Stream；页面刷新或切换会话通过同路径 GET
  重放 active run。该重放不恢复进程栈，服务进程丢失仍由持久化上下文开启新 run。

## Artifact Job

- 扩展现有 generation 为 queued、running、cancel_requested、cancelled、failed、
  completed，并增加 lease owner/expiry、attempt、run/tool IDs、timestamps、last error 与
  block 状态。
- Knowledge 提供 idempotent create/get、claim/renew/release、progress、cancel、block
  ready/failed、publish、conversation unfinished jobs 等内部 API。
- Chat 启动有界 worker pool；多实例通过 lease 竞争，跳过 ready blocks，定期续租；进程
  崩溃后从缺失 blocks 继续。`write_file/edit_file` 创建 job 后等待 terminal result。
- Publish 按 generation ID 幂等；并发 edit 使用 base revision CAS。
- 用户 Stop 后停止领取新 block、abort 当前生成、保留 ready blocks、标记 cancelled，绝不
  后台继续；后续 `resume_job_id` 创建新 attempt 并复用 blocks。
- 前端通过只读 job API 展示 planning、N/M、compiling、publishing、cancelled、failed、
  completed；不建立第二套 Chat SSE。

## 工程拆分与实施顺序

- Chat 按 `runtime/`、`context/`、`plans/`、`tools/`、`artifacts/` 拆分；route 只鉴权验证，
  `chat-agent` 只构造 ToolLoopAgent。Knowledge 只拥有状态、revision 和对象存储，不执行模型。
- 顺序：数据 migration → knowledge/transport 契约 → context projector → Plan mode → rich
  PromptInput/附件 → run lease/cancel → Artifact worker/progress/resume → 删除旧路径 →
  OpenAPI sync 与构建验证。
- 不新增 ADR、不更新其他说明 Markdown、不修改 `AGENTS.md`，本次只维护本计划。

## 验收

- Normal mode 无计划工具；Plan mode 只生成/维护 `*-plan.md`，并能一键切回 Normal 执行。
- 100+ 轮会话、重复 file/search/tool 调用不再线性扩大模型上下文。
- PromptInput 支持图/文件/文本原位混排、粘贴、拖放、上传进度、失败保留与重试；消息和
  MySQL 中无 base64。
- 双标签发送只产生一个 run；Stop 真正终止模型和 Artifact；刷新恢复同一 run，不重复生成。
- Artifact 进程崩溃后续跑，用户 Stop 后不后台继续但可复用 blocks；10/50/100 页 HTML
  可生成、更新、预览和内部跳转。
- 执行 scoped lint/build、chat frontend build、knowledge lint 和 `just sync`；demo 阶段不
  新增测试脚手架。
