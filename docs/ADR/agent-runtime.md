# 当前决策：交互 Agent 与上下文

主循环唯一实现为 `@repo/agent-runtime`，由 Runtime server 与 Electron utility process 共同调用。固定提示词组装、step 控制、tool manifest/outcome、Bash 定义和审批策略共享；审批响应、待审批判断和未完成工具的取消/中断终态也由共享 lifecycle 实现。两端只注入模型、工作区、存储及观测适配器。不得另建本地 Agent-loop 或按执行位置复制 UI 工具协议。环境差异见 [执行模式](sandbox-execution-modes.md)。

状态：当前。以 Runtime 的 run、唯一 ToolLoop、context 和 tool catalog 为云端实现入口。

本地/云端执行与文件生命周期见 [Sandbox 双模式决策](sandbox-execution-modes.md)；其中标记为部分实现或 TODO 的边界仍须按该文档完成，本文不另建兼容模型。

## 执行与传输

Runtime 使用 AI SDK 7 的 `Agent` interface 和一个主 `ToolLoopAgent`。Run 直接创建该唯一实现，
不存在 Agent factory、runtime profile 或按业务语义装配不同 Agent 的选择层。主 agent 持有用户意图、
任务状态、交付顺序和最终综合权。 `subagents` 可作为普通 tool 并行创建 1–3 个短时、只读、独立
context 的 child `ToolLoopAgent`，但 child 不继承父会话或 response lineage，也不成为第二个规划权威。
SDK 拥有模型/工具循环，harness 只处理真实边界：租约、权限、取消、上下文与持久化。主模型在同一个
ReAct loop 中根据工具描述自行决定直接回答、调用普通工具或委派 child；harness 不增加意图分类器、
难度分级、router、planner 或预先任务拆解。

ToolLoopAgent 使用 50 个 model step 的硬上限，并保留最后一步做禁止工具调用的真实结果总结；这只是异常情况下的成本边界，不是正常退出或任务规划机制。Harness 不回扫 step 历史计算连续失败，不判断任务难度，不挑选替代工具，也不安排“恢复 step”。普通 `COMMAND_FAILED` 等结果完整返回模型，由模型根据用户目标和当前证据决定修正、换工具或回答。工具边界只有在统一 `ToolOutcome` 已确认本 turn 无法继续时锁存 stop reason：`SANDBOX_UNAVAILABLE`、`SERVICE_PERMISSION_DENIED`、`PROVIDER_RATE_LIMITED`、`COMMAND_TIMEOUT`、`CODE_MODE_TIMEOUT` 或内部 tool protocol 破坏。下一 model step 固定 `toolChoice: none`，并携带原始 tool 名称及 error code/source/message，要求模型基于已有证据说明根因、已完成/未完成内容和恢复建议。Harness 不自动重放、不动态路由，也不为终态错误发起隐藏 continuation。Transport 的瞬态重试使用自己的有限预算；预算耗尽后才向 ToolOutcome 暴露终态事实。

Bash 采用 Codex exec 的短默认 deadline：`timeout_ms` 默认 10 秒，模型只有在用户目标确实需要已知有界命令时才能显式提高，最大 120 秒。超时返回 `COMMAND_TIMEOUT` 和已有 stdout/stderr，不被随后 sandbox snapshot/destroy 错误覆盖；Runtime sandbox 先终止所有 guest process，保留已停止的 workspace 供 finalizer snapshot，持久化后再销毁 compute。简单问答不得为了追求未要求的穷举精度扩大成候选构建、指标聚合或自建数据流水线。Provider 请求显式启用 `parallel_tool_calls`，SDK 本地工具执行保留默认并发；batch middleware 只实现真实执行约束：`load_skill` 屏障、`ask_user` 独占以及有副作用工具的顺序，不承担规划。

生成期间 composer 保持可编辑并可提交补充。每个活跃 run 创建一个 AI SDK `experimental_createSteering()` 通道；composer 的补充固定调用 `steer()`，在当前 tool 完成后的下一个 step 边界加入同一 run；`queue()` 仅供明确要求“当前任务终答后再做下一项”的调用方使用，不能作为补充上下文的默认路径。工具执行中途不被打断。SDK 是投递、顺序和去重语义的唯一所有者，并通过官方 `steering-message` UIMessage part 把已投递内容放回其真实步骤位置；宿主不得手工插入第二条用户消息或建立平行 loop。任何 `prepareStep` message override 都必须保留 SDK 提供的当前 steering messages，stored-response continuation 也不能只保留 tool result 而删除用户补充。Desktop 在本地 journal 记录 admission，Chat 在 PostgreSQL 记录 admission 并由持有 run lease 的进程投递，使任意服务实例都可接收请求。前端只在 admission 确认后清空原草稿，待投递项显示在 editor 上方；`delivered` 后由 transcript 中的官方 part 接管。`not_delivered` 与 `unconfirmed` 都保留为可见状态，不得自动创建下一 turn 或盲目重发，由用户明确决定是否作为新消息再次发送。client message id 与精确 run/turn、正文和 delivery 绑定，重试只允许完全相同的输入。

PostgreSQL UIMessage 是语义会话记录；Redis 只在 run 活跃期间保存有界的原生 UIMessage SSE replay buffer，负责浏览器断网后的 transport resume；Runtime worker Workflow 负责跨进程的 execution resume。三者不可混同。Redis 的租约、容量、超限和终态删除由 [Chat 活跃流恢复决策](chat-stream-resumption.md) 统一拥有。断开浏览器只释放 subscriber；显式 Stop 才传播用户取消，收口未完成工具为官方 error 状态、取消未完成 todo，并等待 run finalizer。

Run finalizer 必须先尝试 sandbox workspace 持久化与资源释放，再提交 terminal journal 和释放 session lease。若 sandbox 已不存在，snapshot 属于不可恢复失败：生命周期直接转入 release/destroy/released，reconciler 不得每 30 秒重复 snapshot。Dispose/snapshot 失败仍把已经生成的 assistant parts 与失败 metadata 原子写入 journal，再把 run 标记为 failed；资源清理失败不能导致已生成回答从会话记录中消失，也不能把 run 伪装为 completed。

Runtime worker 状态经内部 SSE 汇入原生 preliminary tool results，浏览器仍消费同一条 Chat UIMessage 流。trace 持久化失败不阻断生成。自定义 part 必须遵守 [stream 契约](../../schemas/streaming/chat-uimessage-stream.md)。

消息协议、客户端续跑、引用、文件和恢复遵守当前 [Chat UI 协议](chat-ui-protocol.md)。

## 上下文与权限

Instructions 使用代码拥有的固定层次：稳定策略、执行契约、Skill、已批准记忆与服务端环境。
Tool schema 是输入契约；历史会话和 todo 内容不伪装成系统指令。配置字符串的转义不等于权限控制，
可用工具、scope 和审批仍由代码验证。

UIMessage 到 ModelMessage 的投影保留近期原生语义，预算不足才增量压缩旧前缀。摘要记录覆盖位置并以 revision CAS 写入；失败不推进未完成的覆盖范围。历史文件写入保留路径、SHA、结果和失败事实，不重复大正文与旧工具参数。

所有文本模型统一通过火山 Ark Responses 接入，PostgreSQL UIMessage journal 始终是可重建的业务事实源。有效 lineage 固定使用 Ark 的 `store: true` 与 `previous_response_id`：同一 run 的后续 step 只发送新产生的 `function_call_output` 和真实 steering，不能重复发送已存储的 system/user/assistant 输入，也不能插入工具目录等合成 user message。Stored continuation 只允许连接同 provider/model 且紧邻当前 journal 输入的最后一个已完成输出；切换模型、切换分支、cursor 缺失或最后一步 usage 不可观测时都必须从完整 journal 重建。每个已完成 run 的最后一个 model step input usage 达到有效输入预算（扣除最大输出与 harness/tool 预留）的 80% 水位时，下一次 HTTP run 断开 `previous_response_id` lineage，增量摘要旧前缀并保留近期原生消息。Runtime 不向 Ark 请求注入 OpenAI 私有 `context_management`，也不按模型名称或厂商推断 continuation/reasoning 能力。断链重放会移除 provider stored item reference，不能把它误当成跨 provider 的会话事实。摘要模型、结构化输出或批次处理失败时，本次主模型调用失败且不推进 coverage；不得用“内容已省略”占位符静默丢弃未压缩历史，已经成功的压缩批次 usage 仍计入失败 run。

首次 Bash 自动导入当前会话 source，运行中的工作副本不会随其他保存实时漂移。只有其他工具在同一 run 新增或更新会话资源后才调用 `refresh_conversation_sources`。每个 run 仍从所属服务读取已发布 Skill 和配置等可变权威信息。历史搜索结果是证据，只有刷新/最新需求且现有证据不足时重新查询。Skill 初始仅暴露名称/描述，激活后按需读取资源；草稿不进入执行上下文。

## 工具与模型

`@repo/agent-runtime` 只拥有 tool 协议、manifest/outcome、agent-loop 可复用原子能力及其测试，不得依赖
Runtime 服务的领域 client。`createPortableToolRegistry` 是云端与本地唯一的公共工具定义与执行端口注册表，
统一提供 Web Fetch、Code Mode、Tool Search、Planning、Interaction、Skills 与 Subagents。Runtime 与
Desktop 直接使用这套公共 manifests，再追加各自真实执行环境和领域拥有的 manifests；不存在
`AgentToolProfile`、默认能力二次选择或按业务语义装配 Agent。工具名必须全局唯一，宿主追加重名 manifest
时拒绝启动，不能静默替换公共能力。宿主不得复制公共名单，只注入模型、Web Search、Bash sandbox、
上下文/观测等真实执行差异。最终 manifests/tools 直接交给 SDK，`activeTools` 只表达本次真实可执行集合。
Canvas、Media、Knowledge、Memory 等当前直连领域系统的工具暂留 Runtime 领域边界。共享层不得反向导入
这些具体实现。

- `ask_user` 是无 server execute 的 client tool，批量询问已知独立问题，客户端 `addToolOutput` 后 continuation；依赖答案的后续问题再提出。
- 应用工具使用 ToolOutcome；业务失败可在 UI/persistence 保留结构化结果，同时向模型投影为 error-json。Abort、审批拒绝、输入/协议错误保留原生控制流。 `toolSearch()` 保留原生结果以激活延迟工具。
- Bash 使用 Runtime sandbox role 的真实 Linux 环境，按 run 懒创建并销毁。Runtime server 管理附件导入、明确发布和 finalizer；Runtime worker 只管理已声明的 durable 业务任务。AI SDK `SandboxSession` 的 `run`/file/spawn 接口映射到受限命令、文件与进程 API；模型可见 `bash` 负责普通命令，SDK 写入只能落在临时 `work/outputs`，`sources` 保持只读。权限由 OS/runtime 与出口代理执行，不能靠模型自律。Code Mode 使用 AI SDK local tool caller 与 `toolDiscovery: "description"`，把当前工具目录放在 `code_mode` tool definition 中，不在 Ark stored continuation 的 `input` 中插入合成 user message；它仅编排 manifest 显式声明可进入 Code Mode 的公开 `web_search` / `web_fetch` 读取，两者同时保留 direct call。每个工具的 schema/description 说明自身适用边界，主模型从真实 catalog 自主选择满足用户核心目标的最短链路；中央 instructions 不复制一套按查询数量或任务标签分类的 router。Manifest policy 仍是 Code Mode 的强制能力边界。Code Mode 墙钟预算为 90 秒，覆盖 45 秒 search 与 30 秒 fetch 的串行阶段；独立调用应使用 `Promise.all`，每个调用必须被 await。ToolOutcome、AbortSignal 与 active span 包装在 caller bind 后继续生效；超时、未等待调用和缺失 QuickJS global 会返回带纠正动作的结构化失败。Bash、私有 Knowledge、审批、client/durable 工具和业务写入不得进入 Code Mode。详见 [Sandbox](../微服务/sandbox.md) 与 AI SDK [Code Mode](https://ai-sdk.dev/docs/ai-sdk-core/code-mode)。
- 单个、公开数据驱动的 HTML 交付优先走最短路径：先观察一次公开来源，再在确有缺失时换取同一来源的原始表示；尽量用一次 Bash 完成文件生成与交付物特定的轻量检查，随后显式发布。固定浏览器/ECharts loader 契约不在用户 run 内通过下载运行时、安装测试依赖或另建 harness 重复验证。
- 生成交付物按主 agent 计划串行；普通文件均由主 agent 在 run sandbox 中生成并逐个发布，不存在平行的 durable 文件批次或第二套对话意图。todo 是官方工具结果中的替换快照。
- `subagents` 只在有界 web 调查能从 fresh disposable context 获得实质收益，或 2–3 个真正独立的调查值得并行时使用。调研、报告、多实体或 deep research 这些标签本身都不构成强制委派；小型、串行、依赖主上下文或可由主模型直接调用 `web_search`/`web_fetch` 完成的工作留在主 loop。一次调用仍接受 1–3 个任务，但多个任务必须由模型判断为可独立并发，不能由 harness 自动拆解。
- 每个任务以显式 task/可选冻结 context 创建 fresh child，只开放自动执行的 `web_search`/`web_fetch`，禁止审批、写入和递归委派。子执行通过一个 `tool-subagents` part 的 preliminary result 分别携带有界的紧凑 nested progress；完整 nested UIMessage 只在 terminal result 出现，从而避免逐 delta 累计快照形成 O(n²) transport storage，具体边界归 [Chat 活跃流恢复决策](chat-stream-resumption.md)。用户可见每条委派任务，主模型经 `toModelOutput` 只收到压缩后的各任务结果。父 Stop 的 AbortSignal 必须透传，child step/tool/token 用量分别关联父 toolCall span；进程丢失不恢复该内联执行。child 在自己的 reasoning-and-action loop 中决定具体检索调用，严格保持父模型给出的任务范围，证据足够即停止；缺失信息作为限制返回，不触发开放式补查流水线。
- `subagents` 是 inline child Agent 批次，不等同于 Runtime worker Workflow。Runtime worker 继续承载视频制片、文档处理和 Canvas 等已注册耐久任务，不承载通用文件生成。
- 文本模型只有一个传输契约：Admin 接受并持久化 Ark Responses，Runtime 不再接收可选 dialect，也不按 Kimi、DeepSeek 或豆包模型名分支。所有文本 provider 在压缩水位内使用 Ark response lineage，达到水位或 chain 无效时从本地 journal 重建；provider cursor 不是唯一会话记录。媒体/embedding/rerank 仍使用各自 Ark API。

## 取舍与事实源

薄 harness 减少重复调度与状态机，但持久任务、授权、steering admission 和取消仍需要明确代码边界。不得把传输重连声称为主 agent 的进程崩溃恢复，也不增加隐藏 repair model。Steering 是 AI SDK 7 的实验能力；版本升级必须用真实 SDK producer/consumer 测试确认 outcome、`steering-message` 流和 `convertToModelMessages` 回放仍保持同一顺序。

这一边界采用 [pi-agent core loop](https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent-loop.ts) 的极简形态：模型输出 tool call，宿主校验并执行，tool result 回到同一 loop；没有工具调用时结束，宿主不复制 planner。硬执行边界参考 [Codex exec](https://github.com/openai/codex/blob/main/codex-rs/core/src/exec.rs)：短默认 timeout、调用方显式选择更长 deadline、超时/取消各自保留因果状态。它也采用 OpenAI Agents SDK 的 [LLM orchestration 与 agents-as-tools](https://openai.github.io/openai-agents-python/multi_agent/) 模式和 Anthropic [fold subagents into the main loop](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop) 建议：主模型保留最终综合权，只在真正的上下文隔离或并行收益存在时委派。这些来源证明设计形态，不替本项目规定业务工具、预算或权限；具体边界仍由本 ADR、实现和测试拥有。

实现：[run](../../apps/backend/services/runtime/src/application/agent/runs/run.ts)、 [ToolLoop](../../apps/backend/services/runtime/src/application/agent/agents/tool-loop.ts)、 [projector](../../apps/backend/services/runtime/src/application/agent/context/projector.ts)、 [tool catalog](../../apps/backend/services/runtime/src/application/agent/tools/catalog.ts)、[共享工具](../../packages/agent-runtime/src/tools)。验证：`just test backend/runtime`、`just test shared/agent-runtime`、`just test frontend/@repo/ai-elements` 和受影响构建；流变更同时验证生产者与 UI。依赖版本以 workspace catalogs/lockfile 为准。
