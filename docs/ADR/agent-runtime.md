# 当前决策：交互 Agent 与上下文

状态：当前。以 Chat 的 Agent factory、run、context 和 tool catalog 为实现入口。

## 执行与传输

Chat 使用 AI SDK 7 的 `Agent` interface 和一个主 `ToolLoopAgent`；normal/plan 是行为配置，不是互相交接的独立角色。主 agent 持有用户意图、计划、交付顺序和最终综合权。 `subagents` 可作为普通 tool 并行创建 1–3 个短时、只读、独立 context 的 child `ToolLoopAgent`，但 child 不继承父会话或 response lineage，也不成为第二个规划权威。SDK 拥有模型/工具循环，harness 只处理真实边界：租约、权限、显式 Plan 引用、取消、上下文与持久化。主模型在同一个 ReAct loop 中根据工具描述自行决定直接回答、调用普通工具或委派 child；harness 不增加意图分类器、难度分级、router、planner 或预先任务拆解。

ToolLoopAgent 使用 50 个 model step 的安全上限，并保留最后一步做禁止工具调用的真实结果总结；这高于 SDK 的 20 步保守默认值，适配长任务，同时仍有明确成本边界。Provider 请求显式启用 `parallel_tool_calls`，SDK 本地工具执行保留默认并发；batch middleware 把 `load_skill` 作为屏障并保持 `ask_user` 独占，独立读取可在同一步并行，生成和有依赖的副作用继续串行。

PostgreSQL UIMessage 是语义会话记录；Redis 只在 run 活跃期间保存有界的原生 UIMessage SSE replay buffer，负责浏览器断网后的 transport resume；Executor Workflow 负责跨进程的 execution resume。三者不可混同。Redis 的租约、容量、超限和终态删除由 [Chat 活跃流恢复决策](chat-stream-resumption.md) 统一拥有。断开浏览器只释放 subscriber；显式 Stop 才传播用户取消，收口未完成工具为官方 error 状态、取消未完成 todo，并等待 run finalizer。

Executor 状态经内部 SSE 汇入原生 preliminary tool results，浏览器仍消费同一条 Chat UIMessage 流。trace 持久化失败不阻断生成。自定义 part 必须遵守 [stream 契约](../../schemas/streaming/chat-uimessage-stream.md)。

消息协议、客户端续跑、引用、文件和恢复遵守当前 [Chat UI 协议](chat-ui-protocol.md)。

## 上下文与权限

Instructions 使用代码拥有的固定层次：稳定策略、模式/执行契约、能力投影、Skill、结构化 Bot profile、已批准记忆与服务端环境。Tool schema 是输入契约；历史会话、todo、Plan 内容不伪装成系统指令。配置字符串的转义不等于权限控制，可用工具、scope 和审批仍由代码验证。

UIMessage 到 ModelMessage 的投影保留近期原生语义，预算不足才增量压缩旧前缀。摘要记录覆盖位置并以 revision CAS 写入；失败不推进未完成的覆盖范围。历史文件写入保留路径、SHA、结果和失败事实，不重复大正文与旧工具参数。

上下文压缩按 provider 能力分层，但 PostgreSQL UIMessage journal 始终是可重建的业务事实源。OpenAI Responses 在有效输入预算（扣除最大输出与 harness/tool 预留）的 80% 水位启用原生 `context_management`，让同一个多步 ToolLoopAgent run 内也能产生并沿用 opaque compaction item；其他 Responses dialect 不接收未经验证的 OpenAI 私有字段。Stored continuation 只允许连接同 provider/model 且紧邻当前 journal 输入的最后一个已完成输出；切换模型、切换分支、cursor 缺失或最后一步 usage 不可观测时都必须从完整 journal 重建。每个已完成 run 的最后一个 model step input usage 达到同一水位时，下一次 HTTP run 同样断开 `previous_response_id` lineage，增量摘要旧前缀并保留近期原生消息。断链重放会移除 provider opaque compaction item 和 stored item reference，不能把它们误当成跨 provider 的会话事实。摘要模型、结构化输出或批次处理失败时，本次主模型调用失败且不推进 coverage；不得用“内容已省略”占位符静默丢弃未压缩历史，已经成功的压缩批次 usage 仍计入失败 run。

Plan 是 Chat 注册的不可变 conversation file；首次 Bash 自动导入当前会话 source，显式执行按 `file_id` 读取该精确快照，自然语言执行由 agent 用 Bash 发现候选。只有其他工具在同一 run 新增或更新会话资源后才调用 `refresh_conversation_sources`。每个 run 仍从所属服务读取已发布 Skill 和配置等可变权威信息。历史搜索结果是证据，只有刷新/最新需求且现有证据不足时重新查询。Skill 初始仅暴露名称/描述，激活后按需读取资源；草稿不进入执行上下文。显式 Plan 执行必须先完整读取选中文件。

## 工具与模型

- `ask_user` 是无 server execute 的 client tool，批量询问已知独立问题，客户端 `addToolOutput` 后 continuation；依赖答案的后续问题再提出。
- 应用工具使用 ToolOutcome；业务失败可在 UI/persistence 保留结构化结果，同时向模型投影为 error-json。Abort、审批拒绝、输入/协议错误保留原生控制流。 `toolSearch()` 保留原生结果以激活延迟工具。
- Bash 使用独立 sandbox 服务的真实 Linux 环境，按 run 懒创建并销毁。Chat 管理附件导入、明确发布和 finalizer；Executor 仍只管理已声明的 durable 业务任务。AI SDK `SandboxSession` 的 `run`/file/spawn 接口映射到受限命令、文件与进程 API；模型可见 `bash` 负责普通命令，SDK 写入只能落在临时 `work/outputs`，`sources` 保持只读。权限由 OS/runtime 与出口代理执行，不能靠模型自律。Code Mode 使用 AI SDK local tool caller 与 `toolDiscovery: "conversation"`，仅编排 manifest 显式声明可进入 Code Mode 的公开 `web_search` / `web_fetch` 读取；两者同时保留 direct call。工具描述和静态执行指令给出互斥首选路径：一个查询直接 `web_search`、一个已知 URL 直接 `web_fetch`、多个公开读取或需要去重/过滤/合并时用 `code_mode`、需要 fresh reasoning context 的独立调查才用 `subagents`、文件/CLI/原始响应处理才用 Bash。该规则只约束模型选择，不引入隐藏 router；manifest policy 才是 Code Mode 的强制能力边界。Code Mode 墙钟预算为 90 秒，覆盖 45 秒 search 与 30 秒 fetch 的串行阶段并低于 120 秒 agent chunk；独立调用应使用 `Promise.all`，每个调用必须被 await。ToolOutcome、AbortSignal 与 active span 包装在 caller bind 后继续生效；超时、未等待调用和缺失 QuickJS global 会返回带纠正动作的结构化失败。Bash、私有 Knowledge、审批、client/durable 工具和业务写入不得进入 Code Mode。详见 [Sandbox](../微服务/sandbox.md) 与 AI SDK [Code Mode](https://ai-sdk.dev/docs/ai-sdk-core/code-mode)。
- 单个、公开数据驱动的 HTML 交付优先走最短路径：先观察一次公开来源，再在确有缺失时换取同一来源的原始表示；尽量用一次 Bash 完成文件生成与交付物特定的轻量检查，随后显式发布。固定浏览器/ECharts loader 契约不在用户 run 内通过下载运行时、安装测试依赖或另建 harness 重复验证。
- 生成交付物按主 agent 计划串行；普通文件均由主 agent 在 run sandbox 中生成并逐个发布，不存在平行的 durable 文件批次或第二套对话意图。todo 是官方工具结果中的替换快照。
- `subagents` 只在有界 web 调查能从 fresh disposable context 获得实质收益，或 2–3 个真正独立的调查值得并行时使用。调研、报告、多实体或 deep research 这些标签本身都不构成强制委派；小型、串行、依赖主上下文或可由主模型直接调用 `web_search`/`web_fetch` 完成的工作留在主 loop。一次调用仍接受 1–3 个任务，但多个任务必须由模型判断为可独立并发，不能由 harness 自动拆解。
- 每个任务以显式 task/可选冻结 context 创建 fresh child，只开放自动执行的 `web_search`/`web_fetch`，禁止审批、写入和递归委派。子执行通过一个 `tool-subagents` part 的 preliminary result 分别携带有界的紧凑 nested progress；完整 nested UIMessage 只在 terminal result 出现，从而避免逐 delta 累计快照形成 O(n²) transport storage，具体边界归 [Chat 活跃流恢复决策](chat-stream-resumption.md)。用户可见每条委派任务，主模型经 `toModelOutput` 只收到压缩后的各任务结果。父 Stop 的 AbortSignal 必须透传，child step/tool/token 用量分别关联父 toolCall span；进程丢失不恢复该内联执行。child 在自己的 reasoning-and-action loop 中决定具体检索调用，严格保持父模型给出的任务范围，证据足够即停止；缺失信息作为限制返回，不触发开放式补查流水线。
- `subagents` 是 inline child Agent 批次，不等同于 Executor Workflow。Executor 继续承载视频制片、文档处理和 Canvas 等已注册耐久任务，不承载通用文件生成。
- 文本模型使用 Admin 显式配置的 Responses dialect；不凭 URL 猜协议。支持存储续接的 provider 在压缩水位内使用 response lineage，达到水位或 chain 无效时从本地 journal 重建；不支持 continuation 的 provider 始终重放。provider cursor 和 opaque compaction item 都不是唯一会话记录；媒体/embedding/rerank 使用各自 API。

## 取舍与事实源

薄 harness 减少重复调度与状态机，但持久任务、授权和取消仍需要明确代码边界。不得把传输重连声称为主 agent 的进程崩溃恢复，也不增加隐藏 repair model。

这一边界采用 OpenAI Agents SDK 的 [LLM orchestration 与 agents-as-tools](https://openai.github.io/openai-agents-python/multi_agent/) 模式：manager 保留最终回答和综合权，模型自主决定是否为有界子任务调用 specialist。它也采用 Anthropic [fold subagents into the main loop](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop) 的当前建议：优先一个开放式 tool loop 与渐进工具披露，只在可测的上下文膨胀、真正并行或隔离边界需要时保留 subagent。这些来源证明的是设计取舍，不规定本项目的任务数、工具集或传输上限；具体安全边界仍由本 ADR、实现和测试拥有。

实现：[run](../../apps/backend/services/chat/src/application/agent/runs/run.ts)、 [ToolLoop](../../apps/backend/services/chat/src/application/agent/agents/tool-loop.ts)、 [projector](../../apps/backend/services/chat/src/application/agent/context/projector.ts)、 [runtime tools](../../apps/backend/services/chat/src/application/agent/tools/builtins/runtime.ts)。验证：`just test backend/chat`、`just test frontend/@repo/chat` 和受影响构建；流变更同时验证生产者与 UI。依赖版本以 workspace catalogs/lockfile 为准。
