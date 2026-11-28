# Agent Runtime 内核与宿主

云端 Runtime server 与 Electron utility process 共用 TypeScript 内核。一次用户输入属于一个持久化 Thread，宿主为本次执行创建 RuntimeTurn。Turn 管理取消信号、运行中输入和资源回收。模型调用、工具步骤、审批消息和流由同一 Vercel AI SDK `ToolLoopAgent` 驱动。Workflow worker 承接脱离交互轮次的持久任务。

本项目采用经过源码验证的 Agent harness 架构，包括 Session/Turn/Item、context replacement、权限、取消、Sandbox、完整 core prompt、prompt layering、tool exposure/router、可恢复 loadout、多语言 tool search、小核心、窄 host port、Bash-first 和“完整输出另存、模型只看有界尾部”。AI SDK 仍是唯一 loop、消息、tool execution、approval 和 stream 协议，不引入第二套 agent loop 或 permission/tool wire format。

## 所有权与模块边界

`@repo/agent-runtime` 只拥有跨宿主必须一致的 control plane：

```text
packages/agent-runtime/
├── src/index.ts          # 唯一公开入口；宿主不感知内部文件
├── src/turn/             # Turn 生命周期、输入队列、消息收尾、薄 AI SDK adapter
├── src/context/          # journal 投影、budget、compaction、usage、instructions
├── src/tools/core/       # manifest、registry、router、outcome 与 loadout
├── src/tools/discovery/  # tool_search 与多语言 ranking
├── src/tools/interaction/ # ask_user、planning 与 client UI tools
├── src/tools/research/   # web 与 code mode
├── src/tools/delegation/ # subagent loop 与工具
├── src/tools/files/      # 文件读取、写入与 patch
├── src/tools/publication/ # 产物发布
├── src/tools/skills/     # skill discovery 与按需加载
├── src/execution/        # 权限、命令/文件 admission、进程与会话句柄
└── src/plugins/          # 冻结 snapshot、验证与 MCP 连接
```

这是一个 npm package、一个编译边界和一个 `src/`。不为了外观复制其他语言的 workspace 形态，没有伪 crate，也没有嵌套 `src`。类型、schema 和算法跟随真正的责任 owner；只有真正的跨服务 wire contract 才进入根 `schemas/`。包根显式导出宿主需要的 API，Backend 和 Desktop 只从 `@repo/agent-runtime` 导入，内部重构不再波及宿主。

宿主拥有事实来源和受信能力，不能反向进入 shared kernel：

| 边界 | Backend Runtime | Desktop |
| --- | --- | --- |
| Session/Thread authority | PostgreSQL Session、run、message journal、lease | scope 隔离的 SQLite Thread/Turn/Item journal |
| Turn host | `application/agent/runtime/cloud-turn.ts` | `electron/runtime/session-manager.ts` |
| Context adapter | PostgreSQL checkpoint、文件授权投影、provider lineage | SQLite checkpoint、本地 journal、relay model |
| Execution | Runtime Sandbox/Storage/领域 tools | Seatbelt workspace、local file/command adapters |
| Transport | 原生 UIMessage SSE + Redis 活跃流重放 | 原生 UIMessageChunk + 受限 IPC |

Backend 和 Desktop 只能准备 model、tools、environment、sandbox、persistence 与 observation capability；不得再实现 `ToolLoopAgent`、input queue、context budget/compaction、tool batch planner 或另一套 approval/message protocol。浏览器、Redis 和 provider cursor 都不是 Session authority。

`apps/backend/services/runtime` 与 shared runtime kernel 属于同一 tenant-neutral scope：前者只是把 Session/Turn 持久化、恢复和共享执行能力暴露为内部服务，不是多租户产品宿主。Runtime Server 的 API、数据库、恢复 envelope、插件上下文和并发策略都不认识 tenant、IAM workspace、用户角色、套餐或产品额度；Web Chat、Canvas 等上层 App 拥有业务映射、membership、配额和逻辑隔离。

上层 App 在进入 Runtime 前完成业务授权，只投影已授权且冻结的 model、plugin、tool、permission 与 execution capability。跨进程时使用 workload identity 与短期、受 audience/operation/resource/expiry 约束的 opaque capability，不能把 `tenantId`/`workspaceId` 换个字段名继续下沉，也不能把可猜测的 Session/Asset ID 当作授权。插件 snapshot 只保留内容身份、digest、manifest/activation 与瞬时 connection grant。执行环境中的 `workspaceRoot` 是文件系统能力事实，与 IAM workspace ID 无关。

云端配置 OTLP 时为同一个 ToolLoopAgent 注入官方 `@ai-sdk/otel` integration。模型和工具 span 复用宿主 tracer provider 并关闭输入与输出正文采集。媒体任务使用 Workflow 5 和 PostgreSQL World；交互 Turn 的 lease、审批与恢复仍由 Session journal 驱动。参见 [AI SDK 遥测](https://ai-sdk.dev/docs/ai-sdk-core/telemetry) 与 [Workflow SDK 5](https://vercel.com/blog/workflow-sdk-5)。

浏览器可按 Turn 声明非授权性的执行能力，例如可信顶层页面的 `ui-sdk` bridge。Runtime 只在该 Turn 装配官方语义对应的 `snapshot`、`query`、`act` 客户端工具，结果经原生 UIMessage tool part 和既有 client-tool continuation 回到同一个 AI SDK loop；Cloud 恢复 envelope 固定这项声明，Desktop journal 则把声明绑定到当前 `turnId`，二者都保持冻结的 tool catalog。声明只表示客户端能够执行，不能授予业务权限，且 WebMCP 不创建第二个 Runtime、journal 或工具协议。

本次绿地切换不保留旧 Runtime Session 数据或旧 API 兼容层。Runtime Server 的 Session/Turn schema、HTTP admission、恢复 envelope 和 Storage 调用只使用 Runtime 自有身份；Chat/Desktop 在调用前完成产品授权、Admin 解析和业务资源映射，并把冻结的 `TurnCapabilities` 交给 Runtime。裸 Session/Asset ID 仍不是授权凭据，跨进程访问必须同时满足 workload identity 与对应 capability。

### 证据优先级

本文不是旧方案的兼容说明。设计判断按以下顺序取证：

1. 已核对的参考实现源码、AI SDK 安装版本的 types/source 和上游公开一手资料；
2. 本仓库 Cloud/shared/Desktop 的实际实现、schema 与测试；
3. 由前两项推导并在本文明确标记的 target/proposed 决策。

本仓库此前的 ADR、计划和目录形状不作为事实源或保留约束；与源码冲突的旧结论直接原地改写。上游实现也不是天然正确答案，只有能解释本项目故障边界、且不破坏 AI SDK 单 loop 与 owner 边界的语义才会吸收。

### 设计吸收矩阵

| 语义面 | 吸收的核心 | 在本项目中的落点 | 明确不吸收 |
| --- | --- | --- | --- |
| Loop | Turn 边界、薄 loop 和 request 前 canonical context | `RuntimeTurn` 包住唯一 AI SDK `ToolLoopAgent`；`prepareStep` 只注入 steering/runtime facts | 第二个 agent loop、planner 或 router |
| Session journal | 稳定 Thread/Turn/Item 身份、append-only history 和旧 owner fencing | PostgreSQL/SQLite journal、history revision、attempt epoch、不可变 plugin snapshot | 外部 rollout wire、JSONL 文件格式、provider cursor 作为真源 |
| Context | 完整 journal 与 bounded projection 分离、replacement fail closed；每次请求从 canonical transcript 派生 | shared projection、统一 budget、history/step compaction、checkpoint CAS | 修改原 journal、provider 隐式截断、host 自建 context loop |
| Tools | registry → exposure policy → router finalization、六态 exposure、可恢复 loadout、多语言 BM25 与 Bash-first | portable sources + `AgentToolRegistry`/`AgentToolRouter` + host manifests、`ToolOrchestrator`、`CommandSessions` | 按 Agent 配能力、第二套 tool result 或 host 自建 catalog |
| Sandbox | permission → policy → approval → attempt → process cleanup 不变量 | shared admission；Cloud/Desktop 各自实现隔离与持久化 port | 外部实现布局、wire 字段和未隔离宿主文件假设 |
| Recovery | generation/owner 校验、未知副作用不重放、append-only session projection | Cloud 的不可变 resume envelope、原子 orphan claim、generation fencing；Desktop 保持 fail-closed | 恢复 JS 指令位置、透明续跑 shell、把重新生成冒充原调用续传 |

选择标准是“是否强化本仓库已有边界”，不是“上游是否存在”。上游能力只有在能映射到 AI SDK 单 loop、shared kernel 与 Cloud/Desktop host port 时才采用；否则记录为有意差异。异步/推测压缩、复杂分支 UI 和上游进程拓扑都没有足够收益证据，不进入当前基座。

## Session、Turn、Item 与 lifecycle

这个映射采用经过验证的职责形态，但不复制外部 wire format：

| 通用概念       | 本项目语义                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| Thread/Session | 宿主持久化的执行会话及其 canonical journal                                   |
| Turn           | 一次用户任务；可包含多个 model step 和 tool call                             |
| Item/rollout   | journal 中可恢复的原生 UIMessage/工具状态与 runtime fact                     |
| TurnContext    | turn 开始时冻结的 model、tools、instructions、environment 和 host capability |
| InputQueue     | `RuntimeInputQueue` 对 AI SDK `steer()`/`queue()` 的唯一映射                 |
| tool runtime   | manifest 元数据、approval policy 与公平、可取消的执行 admission              |

`new RuntimeTurn(parentSignal?)` 在任何异步准备前同步创建 input queue，因此 run-input admission 不依赖 sandbox/provider 初始化是否已经完成。一个 `RuntimeTurn` 只能 `start()` 一次；prepare 之后由 kernel 创建唯一 AI SDK loop，宿主消费其原生 stream；turn 结束、失败或取消后，宿主必须调用 `dispose()`，而 kernel 保证已取得的 host resource 只释放一次。Session lease、stream journal finalizer 和进程级 recovery 仍由宿主拥有。前端 transport 持有自己的流订阅，页面切换或重新连接会释放此前已交给 renderer 的订阅。显式 Stop 才向宿主请求取消执行。

one-active-Turn 只约束同一个 Session，不是进程、账号或目录级全局锁。多个 Session 可以并发运行，也可以绑定同一文件系统 workspace；每个 Session 独立持有 `active_turn`。共享目录的写冲突通过工具 CAS、文件现状重读、workspace change observation 和真实文件系统结果暴露；内存中的目录锁既不能覆盖其他 App/CLI，也不能充当事务隔离。

两个宿主都在 `start(prepare)` 中通过 `scope.defer()` 登记每项已取得的资源。准备中途失败或正常结束时按获取的逆序释放。云端 Sandbox 使用本次执行的取消信号并先于工具 catalog 完成释放。任一释放动作失败时仍继续释放其余资源，并将失败交给 journal finalizer。

逻辑 Turn 与物理 invocation/attempt 必须分离。用户任务、同一任务的 approval/client-tool waiting、模型断流重试和崩溃后的边界恢复都属于同一个逻辑 Turn；每次重新取得进程 owner 才创建递增 attempt。Cloud 已实施这一切分：`tool-continuation` 保留原 `thread_turns.id`，将前一 `turn_attempts` 行结算为 `waiting`，并追加新 epoch；step、tool effect、lease 和 Sandbox execution 都精确绑定 `(turn_id, attempt_epoch)`。Desktop waiting approval 也保留原 `turnId`，但尚未持久化可用于崩溃恢复的 physical-attempt envelope。

AI SDK 继续拥有 model/tool loop、stable tool ordering、approval、`prepareStep`、stream 和原生流式取消。TurnScope 将宿主取消与本轮资源的生命周期绑定。kernel 不复制 planner、router、failure counter、repair model 或另一套 stop state machine。交互 Turn 显式使用 SDK 的 `isLoopFinished()`，连续工具调用可以超过 20 步，模型给出最终回复、等待外部输入、取消或失败时交回宿主。普通工具失败作为观察结果回到同一 loop；持久化、权限或协议破坏则 fail closed。

### 恢复不是序列化 loop

`ToolLoopAgent`、AbortController、进程句柄和 stream writer 都不持久化。宿主只持久化 canonical journal、frozen Turn snapshot、committed step/waiting item、tool effect、input settlement、context checkpoint 与 workspace generation；恢复时构造新的 `RuntimeTurn`，由 AI SDK 从这些原生消息重新进入下一个安全 boundary。shared kernel 已定义纯持久事实输入的 boundary classifier；数据库 claim、attempt fencing、workspace 恢复与 finalizer 仍由宿主拥有。

Cloud 与 Desktop 可以使用不同 schema，却必须得到同样的恢复判定：`resume-next-step | resume-waiting | regenerate-model | reconcile-effect | interrupt`。任何 `running` 记录本身都不足以选择 resume；缺少冻结 snapshot、journaled SDK step 或确定 effect 时必须 fail closed。shared classifier 及 waiting/committed/unknown-effect/cancellation 测试已实现。

Cloud 已把该判定接入 orphan recovery。每个 physical attempt 在模型请求或 host effect 前冻结一份不可变、无 secret 的 `turn_resume_envelopes`；它绑定 Session、history item/revision/digest、instructions、resolved tool catalog、workspace、compactor version、remote/provider binding 和执行 snapshot。reconciler 在同一事务锁定权威行并分类：`resume-waiting` 不创建 invocation；`resume-next-step` 与 `regenerate-model` 才递增 epoch、复制 envelope、领取新 lease；取消、缺 envelope、unconfirmed effect，以及 committed effect 没有 journaled SDK step 都转为 `interrupted`。旧 attempt 的 Sandbox 先完成 finalization/release，才把新 attempt 交给 recovery runner。

runner 必须取得上层宿主为该 recovery attempt 续期的 `TurnCapabilities`，并验证其中 provider binding、plugin/skill snapshot 与 instruction/tool/workspace/compactor/remote generation 完全一致；Runtime 不凭 Session 中的业务身份回查 Admin，也不自行恢复产品授权。没有续期 capability 时 fail closed。验证通过后才构造新的 `RuntimeTurn` 进入同一个 AI SDK boundary，并主动消费 response 直至终态。它不恢复旧 JavaScript 指令位置、stream、Sandbox、PID 或终端；纯模型重生成也是显式的新 attempt。Desktop restart 仍把残留 running Turn 标记为 `interrupted`，尚无等价的 physical-attempt envelope 和自动 SDK 重入。完整边界见 [Session Runtime](session-runtime.md#messages-查询与交互恢复)。

### 网络故障恢复

Cloud 与 Desktop 共用当前采样恢复语义。主循环和 isolated child loop 的每个 model step、自动上下文压缩、标题与 memory extraction 调用遇到明确的瞬时网络错误、HTTP 408/409/429 或 5xx 时，只重启当前 model call，最多重试 3 次，退避为 200/400/800 ms 并带少量 jitter；服务端 `Retry-After` 优先决定等待时间，但不增加重试次数。模型流、Code Mode、`web_search`、`web_fetch` 和交互式 Bash 在 Desktop、Gateway、Chat relay、Runtime、provider fetch 和 AI SDK loop 各层都不设置请求总时长、首 chunk、chunk idle 或 response-header deadline；其生命周期只由调用者 AbortSignal、显式 Stop、宿主退出、协议终态或真实网络失败结束。relay 的 heartbeat 只维持中间网络设备和提供可观察进度，不参与超时判定。流式调用由 AI SDK 在当前 step 内恢复；只读网络工具复用同一分类与退避策略，普通业务 HTTP 和显式 one-shot helper 仍可设置自己的 deadline。已经完成的 model step、工具调用、数据库写入和其他副作用不会重放；Bash/curl 也不会自动重放。当前失败采样即使已经输出部分文本，也由 SDK 封闭该 attempt 后重新采样。取消会立即打断退避。HTTP 400/401/403、输入或协议错误、provider-hosted tool execution 等终态失败不进入重试。

主会话与自动压缩的重试通过 transient `data-model-retry` 发布 `retrying/recovered/failed` 和脱敏原因枚举 `dns | timeout | connection_reset | incomplete_stream | provider_unavailable`，两个宿主的会话界面显示同一套重连进度；事件不写入 journal 或模型上下文，也不暴露 hostname、URL、request id 或 provider 原文。Desktop 的 HTTP relay 显式保持 chunked response，并把上游未完成流规范化为 retryable model error，避免代理层把它降级为不可分类的 `ERR_INCOMPLETE_CHUNKED_ENCODING`。这套策略适用于首个采样及工具后的后续采样，不重启整个 Turn。child loop 保持同一个 subagent progress item，后台标题与 memory extraction 不制造主会话状态。

所有 manifest 声明为非流式 `effect: read` 的 Tool 都采用相同的 3 次瞬时网络失败重试边界，包括内置读取、公共 Web 工具和 MCP 只读工具。`web_fetch` 还把结构化的 408/409/429 和 5xx 结果纳入重试；403 等权限错误立即返回。`subagents` 是 streaming read tool，因此禁止从 manifest 外层重放整个工具；其 child loop 只恢复中断的 model call，已完成的 child Web tool 不会再次执行。`write/add/update/destructive/unknown` Tool 可能包含 POST、上传、扣费或其他副作用，只有各自拥有幂等键或恢复协议时才可在工具内部重试。任意 Bash/`curl` 命令同样不透明重放；失败作为工具结果交回模型，由模型结合命令语义决定下一步。

## 运行中输入与取消

运行中只有三个不同动作：

- `follow-up` 调用 `steer()`，在当前 turn 的下一个安全 model boundary 进入上下文；
- `next-turn` 调用 `queue()`，等待当前任务终答后创建下一 turn；
- Stop/interrupt 使用宿主的 AbortSignal，取消当前执行，不伪装成一条输入。

每个 turn 只有一个 `RuntimeInputQueue`。SDK 在 model step 接收消息时确认投递，按 id 返回 `steering-message`。准备阶段也允许接收输入，因此 kernel 持有尚未结算的输入；准备失败或 turn 关闭时，尚未投递的输入以 `not-delivered` 结算，宿主随后可以结束 journal 写入。 `prepareStep` 改写 messages 时必须保留已接收的 steering message。 `not_delivered` 和 `unconfirmed` 都向用户可见，由用户决定是否重新提交。

普通用户 follow-up 不抢占正在采样的 response，也不抑制该 response 已生成的 tool call；AI SDK 在当前 step 及其工具完成后的安全 boundary 注入 steering message。补充输入改变后续决策，但不会被解释成对原任务的停止。只有显式 Stop 使用 run AbortSignal。前端在 admission 成功后立即把补充投影到正文，并在官方 `steering-message` 以同一 id 到达时去重；该乐观投影不是 journal authority，刷新后仍以持久 input 状态和 stream 为准。

## Journal、模型上下文与压缩

PostgreSQL/SQLite journal 是唯一可重建的会话事实源。provider response id 只是同 provider/model 且与 journal 直接相邻时可用的优化；切换模型、分支、cursor 缺失、lineage 不匹配或到达水位后都从 journal 重建。不能把 provider cursor、Redis replay 或内存中的 `ToolLoopAgent` 当作历史。

shared context manager 将完整 UIMessage journal 投影为 bounded ModelMessage：

1. `contextWindow` 是 provider 的输入容量，`maxOutputTokens` 是独立输出上限，二者不得相减。统一 planner 先保留 8000 tokens 的 instructions/tools/runtime framing，得到 `inputCapacity = max(512, contextWindow - 8000)`；自动压缩水位 `compactAt` 取 `inputCapacity`、模型窗口 90% 和显式模型水位三者的最小值。stored lineage 到达同一水位时从 journal 重建。UI `autoCompactAt`、history projection 和轮内 step compaction 必须读取同一个 planner，不能各自维护公式。
2. 近期 tail 保留原生消息，并在 `compactAt` 内最多为 compacted prefix 预留 6000 tokens；planner 同时给出 `summaryMaxTokens` 和 `recentTailTokens`。只压缩旧前缀，生成的摘要在安装 replacement/checkpoint 前必须截断到摘要预算。历史投影和轮内压缩从 tail 预算中为旧用户原文最多预留一半，上限为 20,000 个估算 token（含消息封装）。优先选择较新的用户文本，边界消息保留首尾并标记省略，已覆盖的原文按原顺序置于摘要之前，近期消息置于摘要之后。恢复时从当前分支 journal 重选已覆盖的用户文本，排除已在 tail 的同一条消息。保留旧用户文本时跳过附件，轮内已有的最近用户消息在预算允许时可整体保留。用户原文的上限按 tail 大小缩放并在两个宿主和压缩路径共用。单条超长 prefix 消息按连续 chunk 全量送给 compactor；工具与 `data-*` 的大 payload 可以有界截断，保留调用 ID、首尾内容和截断标记。最终 ModelMessage 投影若仍超过 `inputCapacity` 就拒绝调用，不能依赖 provider 隐式截断。
3. Provider dialect adapter 独占 `providerOptions`、stored continuation、response metadata、远程 compaction wire 和能力判定；shared runtime 只消费注入的 `StoredModelContinuation` 与 `RemoteCompactionAdapter`，宿主和 kernel 都不得按模型名或 base URL 猜协议能力。当前 Cloud adapter 对 OpenAI 一方 Responses 端点使用 `compaction_trigger`，以 `store: false` 请求和重放加密的 `compaction` item。checkpoint 绑定 provider 和 model；切换后从完整 journal 投影。Ark stored Responses 只有在 `previous_response_id` 与 journal 直接相邻时才发送最后一个 assistant 之后的 user/tool suffix；lineage 缺失时移除旧 `itemId` 并物化完整本地 prompt，禁止发送悬空 `item_reference`。其他端点和 Desktop relay 采用普通文本摘要，不要求 provider 支持结构化输出或 JSON schema；压缩器增量合并旧摘要和新 prefix，持久化 `runtime-context-v1`。
4. checkpoint 记录 `coveredThroughMessageId` 和 revision。两端先完成近期消息转换、输入窗口校验与取消检查，再由 PostgreSQL/SQLite 通过 CAS 安装；compaction 或 checkpoint 写入失败会终止本次主模型调用，不能假装压缩成功或推进 coverage。Cloud 把 `upload_artifacts` 保留为普通 tool part，并将其 terminal result 投影为 `data-file` 写入当前助手消息；Cloud 以 turn 租约约束 journal 写入，终态复用同一 item 和 ordinal。Desktop 不提供上传工具，本地文件直接保留在用户选择的 workspace。轮内压缩覆盖完整工具步骤时，checkpoint 记录输入消息、助手消息和该步的工具调用 ID；读取时会验证工具结果已终态、消息身份和远程模型 binding，不匹配就从原 journal 重新投影。这个 checkpoint 只证明“可以重建模型上下文”，不是进程崩溃后的 Turn resume envelope。
5. 文件授权/字节加载是 host 的 `prepareRecent` adapter；shared manager 不访问 Storage、数据库或本地文件系统。持久 journal 从不因 projection/pruning/compaction 被改写。

压缩是可能持续数秒的可见 runtime item。history projection 和轮内 step compaction 都通过 transient `data-context-compaction` 发布 `started/completed` 及 `history|step` phase；UI 在 started 后立即显示状态，在 completed 后清除。Cloud 在主 SSE writer 建立前发生的 history 事件先按序缓冲，writer 建立后立即发送；Desktop 直接实时发送。失败不会伪造 completed，而是终止本次模型调用并保留原 journal/checkpoint。

replacement generation 校验是必须保留的语义。当前 projection 在单 active Turn 内同步完成，checkpoint revision CAS 和 Cloud lease 阻止旧 owner 安装结果；因此暂不引入 speculative/background compaction。Cloud checkpoint 已绑定 source history revision/digest、instruction/catalog/workspace digest、compactor version、remote binding 和 estimated usage；恢复时还必须与 attempt-scoped resume envelope 完全一致。若以后为降低延迟并行生成摘要，proposal 还必须绑定精确 checkpoint revision；安装时原子验证 generation，并把生成期间新增的 live suffix 保留在 replacement 后。任一身份变化都丢弃 proposal，仍结算已发生的 usage。没有这些条件不得上线后台压缩。

ContextUsage 表示最近一次活动模型上下文，不是会话累计花费：每个 model request 在 middleware 完成最终 prompt/tool 组装后立即通过 transient `data-context-usage` 发布 portable estimate；该 step 完成后再用 provider input usage 加上会留在后续上下文中的非 reasoning 输出发布 confirmed snapshot。它不按文本 delta/token 高频更新。分类始终是估算，分类和等于展示总量。Cloud 从两个 model-step 边界实时暴露该值；Desktop 使用相同边界，并在 step 完成时把 confirmed snapshot 持久化到 thread。两端都展示原始 model window、统一自动压缩水位和是否已有 checkpoint，且压缩不会删除原始 journal。

Desktop relay 不使用 stored provider lineage，但使用同一个 journal projection、budget 和 checkpoint 机制。其 authority 是 Desktop 宿主数据目录中的 `runtime-v2.sqlite`，schema 为 `threads`、`thread_turns`、`items`、`context_checkpoints`、`turn_plugin_snapshots`，`user_version=2`。上层应用可以为不同登录态选择隔离的数据目录，但 shared runtime schema 不保存 tenant/workspace/user identity。旧 `runtime.sqlite`、`runtime-v1.sqlite`、`sessions.sqlite` 和 Electron `userData` journal 不读取、不迁移、不覆盖；这是明确的零兼容切换。

## 工具 runtime

工具 schema/description 是输入和局部规划约束的事实源。前置条件与限制附着在对应 manifest，core instructions 不复制一套工具路由或产品工作流。`ToolOutcome`、native approval、UI metadata 和 streaming semantics 保持 AI SDK 原语。

主会话的中途沟通由模型生成。core prompt 中的 commentary contract 直接进入共享 base prompt：多步任务在首个工具前说明切入点，通常每一至三个实质步骤更新一次，任务仍在运行时不得超过六个步骤或十次工具调用没有正文；长工具执行前说明它要解决什么，失败后先说明影响和路径变化。客户端直接显示模型正文。AI SDK 保留模型提供的 phase，缺省时仍正常显示；`useChat` 继续消费官方 `UIMessage.parts`，不增加前端合成状态或另一套 SSE 协议。

工具先进入 source registry，再应用 Turn policy，最后冻结为不可变 router。manifest exposure 明确区分 `direct`、`deferred`、`direct-model-only`、`deferred-model-only`、`code-mode-only` 和 `hidden`。router 独立产出 executable `tools`、model `activeTools`、稳定 `toolOrder`、Code Mode caller map、source map 与公共 `tool_search`。宿主不能靠删除 ToolSet 或另建清单表达同一语义。

初始步骤保持小而稳定的热工具面。核心工具只有两类装配来源：共享 runtime 内置提供与宿主无关的常规能力，registry/router 自带 `ask_user` 和 `tool_search`，portable catalog 提供 `web_search`/`web_fetch`、`code_mode`、`subagents` 和 `update_plan`；执行宿主按真实沙箱实现贡献 `bash`、`read_file`、`apply_patch` 和 `write_file`。Cloud 另外贡献 `upload_artifacts` 和 source refresh，Desktop 不注入上传能力。Runtime 的 Media 与 plugin/MCP 是可选扩展而非第三套核心工具装配；Media 始终注册 `generate_images` 和 `generate_video`，不暴露模型枚举工具，图片自动使用已配置的 Seedream，视频固定使用 Seedance 2.5。调用任一生成工具前必须通过共享 `ask_user` 确认分辨率、宽高比及图片数量或视频时长。Media、source refresh 和 plugin/MCP 等低频或大 schema 能力是 deferred；发现后按第一次加载顺序追加，后续 Turn 从 canonical UIMessage journal 恢复。延迟加载不改变授权、审批、执行或可用能力。

首步需要区分“知道有这项能力”和“可以直接调用”。批量读取同构公开资料、去重和汇总交给 Code Mode；需要分开取证、各自判断再综合时可用 subagents。普通查询保留直接检索。`tool_search` 是共享运行时的公共核心工具，每个 Turn 都直接可见；宿主只提供待检索 manifest，不能按环境开关搜索能力。它公布可搜索的内建能力名称和 MCP namespace，检索索引覆盖名称、描述、planning summary、namespace、schema property 与 description；排序使用 Unicode 分词、名称/namespace 加权和 BM25。匹配后 AI SDK 在下一步提供完整 schema。[OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search)是延迟加载和 append-only cache 语义的事实基线。

Artifact publication 与 workspace persistence 是两条不同责任链。`upload_artifacts({ paths })` 是 Cloud adapter 独有能力：它把 Cloud workspace 路径的当前字节提交为 Session file/immutable Storage revision，再用 `toolCallId + artifactIndex` 记录内部 occurrence。occurrence 必须引用同一 attempt 已提交的 `workspace_effect`，精确固定 asset/revision/hash/path，但这些字段不进入 `PublishedWorkspaceFile` 或 `data-file`；公开引用仍以稳定 `file_id` 和可选 `workspace_path` 为准，`data-file.id = file_id`。Desktop workspace 已经是用户可直接访问的持久目录，不做二次上传、file-id 映射或 `data-file` 投影。普通 workspace create/update/delete 即使从未 publication 也必须持久化；下次 Turn 只恢复 workspace 文件，不恢复 Cloud occurrence 或把旧 publication 重新发到 stream。

“小核心”在这里是 exposure contract，不是固定一组工具名。完整 catalog 在 Turn 开始时冻结并持久化 digest，initial exposure 保留读、改、执行、检索、规划和澄清闭环，`tool_search` 与 `ask_user` 始终直接可见，其余能力通过同一 AI SDK `tool_search` 激活。六态 exposure、稳定 order 和 journal loadout replay 已实施；初始 schema tokens、激活命中率和无效选择仍需补生产观测，后续按数据调整 hot surface，不能借此移除用户已获授权的能力。

`bash({command})` 返回退出码或可继续交互的 `session_id`；后续仍调用同一个 `bash({session_id,stdin?})` 写入终端或轮询增量输出，不向模型暴露第二个进程工具。PTY 输入、进程所有权、审批、取消与句柄回收遵循共享执行内核。模型用 `max_output_tokens` 控制当前读取窗口，默认 10,000；超过窗口时返回 UTF-8 安全的有界 head/tail 和截断提示。桌面终端归 Thread 所有，正常 Turn 结束后可接回；停止会话、切换执行权限、删除会话或宿主退出会撤销句柄。云端物理 guest 以 Session 为复用键，执行权仍按 Turn attempt/workspace generation 分配；结束时冻结工作区、持久化实际 checkout 变更并 retain，下一 generation 重绑时清除 attempt-local 状态。显式交付文件与普通工作文件共用文件身份和写入检查。

完整输出通过窄 host port 落地：shared `CommandSessions` 只接收 `ProcessIO.retainOutput()` 提供的 model-readable path，并且仅当**本次读取窗口实际截断**时在 `full_output` 中暴露引用；模型仍用同一个 Bash 按 byte offset/limit 读取，不增加第二个 output tool。shared package 不导入数据库、Electron 或宿主文件系统。

两个宿主都从进程启动起串行保存 stdout/stderr 原始字节，而不是在截断发生后才补写。Cloud trusted guest supervisor 写入独立的 root-owned `/run/output/<id>.log`；该挂载对受限命令只读、不进入 `/workspace` 业务快照，并在 guest rebind 前随 attempt-local 状态清理。Desktop 写入 `<attachmentRoot>/.runtime-output/<id>.log`，Seatbelt 允许模型进程读取但拒绝替换，生命周期随 local Thread，删除 Thread 时与 attachment root 一起清理。写盘失败会终止命令并拒绝发布不完整引用。当前边界保证执行 attempt 内的完整输出可追查，不承诺 Cloud 后续 Turn 仍可访问，也不把完整日志自动提升为交付文件或长期会话历史。

SDK 可以并发发出 tool call，但实际执行必须经过每个 catalog 实例的 `ToolExecutionScheduler`：

- 默认工具独占，只有 manifest 明确 `planning.parallelizable: true` 才共享读 admission；
- 排队顺序公平，独占项形成 barrier，后到的并行调用不能越过；
- 排队期间的 AbortSignal 会在执行前移除 waiter，已取得 admission 的操作在 `finally` 释放；
- async iterable 工具必须声明 `policy.streaming`，scheduler 持有 admission 直到 terminal yield；
- local tool caller 是编排壳，不重复取得 scheduler admission；它绑定的叶子工具仍逐个经过同一 scheduler，避免外层等待排在自身 admission 后的内层调用；
- duplicate tool name 启动即失败，不允许宿主静默替换 shared capability。

Code Mode 没有 wall-clock deadline，Turn AbortSignal 负责取消；QuickJS CPU、内存、bridge 数量和输入输出大小仍受独立资源限制。Code Mode 编排壳不持有 catalog admission，沙箱中实际调用的 `web_search`、`web_fetch` 等叶子工具持有 admission。

ToolLoop 中间件不通过删除 provider tool call 来制造串行；并发、权限和副作用边界在 executor admission 执行。Portable registry 只含已证明跨 Backend/Desktop 共用的基础能力。Runtime 自有的 Media 作为 host manifest；它把图片/视频 provider 的长任务包装成幂等 durable operation，但 `generate_images` / `generate_video` 始终阻塞当前 tool call 直到终态 Session file 已发布，不暴露 production/workbench 投影。Knowledge、Canvas 和外部 MCP 都通过同一套 catalog/release/installation/activation/Turn snapshot/connection lifecycle 注入，Runtime 不再持有固定服务 tool client 或第二套插件 adapter。产品 memory 由上层宿主投影。完整 ownership、去密持久化、lazy discovery、MCP fail-closed 与当前仅 `knowledge_search`/`get_canvas_context` 的能力面见 [Agent plugins](agent-plugins.md)。

## Instructions 与 runtime facts

system instructions 在一个 Turn 内固定。`InstructionPlan` 按稳定顺序冻结 model base、完整 core prompt 和可替换 world-state sections，并提供 section identity、digest 与 diff。core prompt 包含协作人格、写作、工具前和工作中沟通、最终答复、端到端所有权、权限、持续执行、编码、文件工具、project instructions/skills 与格式契约。Skill listing/activated body、Memory、日期和 `<execution_environment>` 作为独立 world-state section，工具特定 workflow 继续放在 declaration。Cloud 与 Desktop 共用同一 builder，不能各自拼 prompt。

`<execution_environment>` 是 turn snapshot，由 shared renderer 从宿主结构化 capability 生成。运行中 workspace change 是 transcript 中的 `<runtime_context type="workspace_changes">` user-role runtime fact，不修改 system prompt，也不冒充新的产品用户请求。路径是不可信数据；模型只重读与当前任务相关的文件。

## 取舍与一手证据

实现基线覆盖 model prompt、session/turn、world state、tool runtime、exposure、router finalization、structured prompt section、loadout replay、Unicode BM25、文件工具、output spill 与 Bash 观察窗口。外部 loop、provider protocol、approval wire format、JSONL session、权限和 host filesystem 假设不进入本仓库；职责分层按 TypeScript shared kernel 边界实现。插件治理与执行边界由 [Agent plugins](agent-plugins.md) 单独维护。公开依据包括 [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search)、[prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) 和 [Vercel AI SDK `ToolLoopAgent`](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)。

实际 loop、消息、approval、stream 和 tool execution 仍由本仓库已采用的 [Vercel AI SDK `ToolLoopAgent`](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent) 提供；shared kernel 只实现 SDK 没有拥有的 Session/Turn control-plane boundary。云端与本地使用不同持久化/隔离 adapter，但遵守同一 lifecycle contract。

被否决：按外部实现布局做目录级复刻、一个 npm package 内保留多个嵌套 `src`、将实现路径作为公开 API、保留旧 `agent/` facade、host 各自维护 loop/context/prompt、provider cursor 作为事实源、静默压缩失败、通过 middleware 丢弃 tool call、为了迁移旧 SQLite 建双轨 adapter。

## 当前实现状态与架构缺口

| 能力 | 状态 | 代码事实 / 下一边界 |
| --- | --- | --- |
| 单一 AI SDK loop、Turn input queue、逆序资源释放 | implemented | Cloud/Desktop 都经 `RuntimeTurn`；`steer`、`queue`、Stop 分离 |
| Thread/Turn/Item journal、one-active-Turn、attempt fencing | implemented | Cloud 有 history revision、`turn_attempts`、attempt-bound lease/step/Sandbox journal；Desktop 有 SQLite Thread/Turn/Item |
| logical Turn 与 invocation/attempt 分离 | implemented in Cloud; partial cross-host | Cloud continuation 复用 `thread_turns.id`、追加 attempt 并结算 `waiting`；Desktop 保留 waiting Turn identity，但尚无可恢复 physical-attempt envelope |
| tool effect consistency | implemented in Cloud | execute wrapper 在进入 host code 前原子 claim；`(turn_id, tool_call_id)` 在逻辑 Turn 内稳定，完整 canonical input digest 判等、redacted input 仅供观察；completed 可跨 attempt replay，重复 claim、异参或 unconfirmed 一律 fail closed |
| journal → bounded model context、双层 compaction、checkpoint CAS | implemented with limits | 两端能 fail closed 重建上下文；Cloud checkpoint 已绑定 history/instruction/catalog/workspace/compactor/remote generation，并参与 recovery 校验 |
| 冻结 model/tool/plugin/permission snapshot | implemented in Cloud; partial cross-host | Cloud 使用 attempt-scoped immutable resume envelope；恢复必须由上层宿主续期 `TurnCapabilities`，缺失时 fail closed；Desktop 尚无等价 envelope |
| tool exposure 与小热工具面 | implemented with observability gap | 六态 exposure、registry/router、公共 search/interaction、稳定 order、Unicode/schema BM25 和 journal loadout replay 已实施；缺少生产 schema token 与激活质量 SLO |
| Sandbox 进程、取消、工作区 finalizer | implemented with environment gaps | 代码路径已存在；真实 macOS 签名包、gVisor/Kubernetes 和网络 broker 仍按 Sandbox ADR 验收 |
| 五类 recovery boundary classifier | implemented; host-specific execution | shared 只从持久事实判定；Cloud 原子 claim 并执行安全的 model-boundary 恢复，Desktop restart 仍 fail closed |
| 进程崩溃后的同 Turn 恢复 | implemented in Cloud with fail-closed branches | Cloud 只恢复 `resume-next-step`/`regenerate-model`，waiting 保持稳定；取消、缺 envelope 与 unknown/unreconstructable effect 中断。Desktop 仍是 gap |
| Bash 完整输出 + 有界模型窗口 | implemented with lifecycle limits | shared 只暴露实际截断时的引用；Cloud 保留到 attempt finalize/rebind，Desktop 保留到 Thread 删除 |

剩余边界不授权在 shared kernel 中增加第二套 loop 或直接重放副作用：

1. Desktop 需要自己的 immutable physical-attempt envelope、generation validation 与 restart claim；在此之前继续明确中断，不模拟 Cloud 数据库协议；
2. Cloud 的 `reconcile-effect` 仍需要各副作用 owner 提供可查询 operation ID，无法证明结果时继续中断而不是扩大自动恢复；
3. Desktop retained output 尚需按真实线程规模补充配额、GC 与可观测性；Cloud/desktop 的环境验证仍按 Sandbox ADR 执行；
4. 最后用 tool schema token、deferred activation 和选择质量数据收紧热工具面；无延迟证据前不做 speculative compaction。

## 实现与验证边界

- shared kernel：[public API](../../packages/agent-runtime/src/index.ts)、[RuntimeTurn](../../packages/agent-runtime/src/turn/turn.ts)、[recovery classifier](../../packages/agent-runtime/src/turn/recovery.ts)、[context projection](../../packages/agent-runtime/src/context/history.ts)、[tool scheduler](../../packages/agent-runtime/src/tools/core/scheduler.ts)
- Backend host：[run repository](../../apps/backend/services/runtime/src/application/agent/runs/repository.ts)、[lease](../../apps/backend/services/runtime/src/application/agent/runs/lease.ts)、[cloud turn](../../apps/backend/services/runtime/src/application/agent/runtime/cloud-turn.ts)、[model context](../../apps/backend/services/runtime/src/application/agent/context/model-context.ts)
- Plugins：[plugin lifecycle](agent-plugins.md)、[shared manager](../../packages/agent-runtime/src/plugins/manager.ts)、[Runtime catalog](../../apps/backend/services/runtime/src/application/agent/tools/catalog.ts)
- Desktop host：[session manager](../../apps/frontend/apps/desktop/electron/runtime/session-manager.ts)、[journal](../../apps/frontend/apps/desktop/electron/runtime/journal.ts)

最低验证包括 shared、Backend、Desktop tests/typecheck/build，checkpoint 冲突、queued tool cancel、turn 资源只释放一次、steer/queue、非抢占式 follow-up、interrupted recovery 和 host finalizer。PostgreSQL/Redis integration skip、真实 provider、Docker/gVisor/Kubernetes、macOS 版本矩阵和发行签名仍是独立环境验收，不能由 mock 单测或类型检查替代。
