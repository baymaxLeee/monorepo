# Agent Runtime 内核与宿主

云端 Runtime server 与 Electron utility process 共用 TypeScript 内核。一次用户输入属于一个持久化 Thread，宿主为本次执行创建 RuntimeTurn。Turn 管理取消信号、运行中输入和资源回收。模型调用、工具步骤、审批消息和流由同一 Vercel AI SDK `ToolLoopAgent` 驱动。Workflow worker 承接脱离交互轮次的持久任务。Pi 对这里的影响集中在工具和宿主边界，模型可以通过少量常用文件工具和 Bash 完成工作，其他能力按需发现。

## 所有权与模块边界

`@repo/agent-runtime` 只拥有跨宿主必须一致的 control plane：

```text
packages/agent-runtime/
├── src/index.ts          # 唯一公开入口；宿主不感知内部文件
├── src/turn/             # Turn 生命周期、输入队列、消息收尾、薄 AI SDK adapter
├── src/context/          # journal 投影、budget、compaction、usage、instructions
├── src/tools/            # manifest/outcome/catalog 与少量可移植工具
├── src/execution/        # 权限、命令/文件 admission、进程与会话句柄
└── src/plugins/          # 冻结 snapshot、验证与 MCP 连接
```

这是一个 npm package、一个编译边界和一个 `src/`。不为了外观复制 Rust workspace：没有 `core/protocol/execpolicy/sandboxing/apply-patch` 伪 crate，也没有嵌套 `src`。类型、schema 和算法跟随真正的责任 owner；只有真正的跨服务 wire contract 才进入根 `schemas/`。包根显式导出宿主需要的 API，Backend 和 Desktop 只从 `@repo/agent-runtime` 导入，内部重构不再波及宿主。

[Codex 1145028ae4](https://github.com/openai/codex/tree/1145028ae47e8119955323d38ce34122d418f951/codex-rs) 是语义和安全基线，不是目录模板：保留 Turn/Session、输入 admission、context 水位、执行权限、取消和恢复等不变量，不复制 Rust loop、wire format 或内部模块数量。AI SDK 继续负责采样、tool loop、approval 和 stream。来自 Codex 的实际移植算法保留许可和声明于 [third_party/codex](../../packages/agent-runtime/third_party/codex/NOTICE)。

宿主拥有事实来源和受信能力，不能反向进入 shared kernel：

| 边界 | Backend Runtime | Desktop |
| --- | --- | --- |
| Session/Thread authority | PostgreSQL Session、run、message journal、lease | scope 隔离的 SQLite Thread/Turn/Item journal |
| Turn host | `application/agent/runtime/cloud-turn.ts` | `electron/runtime/session-manager.ts` |
| Context adapter | PostgreSQL checkpoint、文件授权投影、provider lineage | SQLite checkpoint、本地 journal、relay model |
| Execution | Runtime Sandbox/Storage/领域 tools | Seatbelt workspace、local file/command adapters |
| Transport | 原生 UIMessage SSE + Redis 活跃流重放 | 原生 UIMessageChunk + 受限 IPC |

Backend 和 Desktop 只能准备 model、tools、environment、sandbox、persistence 与 observation capability；不得再实现 `ToolLoopAgent`、input queue、context budget/compaction、tool batch planner 或另一套 approval/message protocol。浏览器、Redis 和 provider cursor 都不是 Session authority。

## Session、Turn、Item 与 lifecycle

这个映射采用 Codex 的职责形态，但不复制其 wire format：

| Codex 概念     | 本项目语义                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| Thread/Session | 宿主持久化的会话及其 workspace 绑定                                          |
| Turn           | 一次用户任务；可包含多个 model step 和 tool call                             |
| Item/rollout   | journal 中可恢复的原生 UIMessage/工具状态与 runtime fact                     |
| TurnContext    | turn 开始时冻结的 model、tools、instructions、environment 和 host capability |
| InputQueue     | `RuntimeInputQueue` 对 AI SDK `steer()`/`queue()` 的唯一映射                 |
| tool runtime   | manifest 元数据、approval policy 与公平、可取消的执行 admission              |

`new RuntimeTurn(parentSignal?)` 在任何异步准备前同步创建 input queue，因此 run-input admission 不依赖 sandbox/provider 初始化是否已经完成。一个 `RuntimeTurn` 只能 `start()` 一次；prepare 之后由 kernel 创建唯一 AI SDK loop，宿主消费其原生 stream；turn 结束、失败或取消后，宿主必须调用 `dispose()`，而 kernel 保证已取得的 host resource 只释放一次。Session lease、stream journal finalizer 和进程级 recovery 仍由宿主拥有。前端 transport 持有自己的流订阅，页面切换或重新连接会释放此前已交给 renderer 的订阅。显式 Stop 才向宿主请求取消执行。

两个宿主都在 `start(prepare)` 中通过 `scope.defer()` 登记每项已取得的资源。准备中途失败或正常结束时按获取的逆序释放。云端 Sandbox 使用本次执行的取消信号并先于工具 catalog 完成释放。任一释放动作失败时仍继续释放其余资源，并将失败交给 journal finalizer。

AI SDK 继续拥有 model/tool loop、stable tool ordering、approval、`prepareStep`、stream 和原生流式取消。TurnScope 将宿主取消与本轮资源的生命周期绑定。kernel 不复制 planner、router、failure counter、repair model 或另一套 stop state machine。交互 Turn 显式使用 SDK 的 `isLoopFinished()`，连续工具调用可以超过 20 步，模型给出最终回复、等待外部输入、取消或失败时交回宿主。普通工具失败作为观察结果回到同一 loop；持久化、权限或协议破坏则 fail closed。

### 网络故障恢复

Cloud 与 Desktop 共用 Codex 式的当前采样恢复语义。模型调用遇到明确的瞬时网络错误、HTTP 408/409/429、5xx、120 秒建连或流 idle timeout 时，AI SDK 只重启当前 model step，最多重试 3 次，退避为 200/400/800 ms 并带少量 jitter。已经完成的 model step、工具调用和工具副作用不会重放；当前失败采样即使已经输出部分文本，也由 SDK 封闭该 attempt 后重新采样。取消会立即打断退避。HTTP 400/401/403、输入或协议错误、provider-hosted tool execution 等终态失败不进入重试。

每次重试通过 transient `data-model-retry` 发布 `retrying/recovered/failed`，两个宿主的会话界面显示同一套重连进度；事件不写入 journal 或模型上下文。Desktop 的 HTTP relay 显式保持 chunked response，并把上游未完成流规范化为 retryable model error，避免代理层把它降级为不可分类的 `ERR_INCOMPLETE_CHUNKED_ENCODING`。这套策略适用于首个采样及工具后的后续采样，不重启整个 Turn。

所有 manifest 声明为非流式 `effect: read` 的 Tool 都采用相同的 3 次瞬时网络失败重试边界，包括内置读取、公共 Web 工具和 MCP 只读工具。`web_fetch` 还把结构化的 408/409/429 和 5xx 结果纳入重试；403 等权限错误立即返回。`write/add/update/destructive/unknown` Tool 可能包含 POST、上传、扣费或其他副作用，只有各自拥有幂等键或恢复协议时才可在工具内部重试。任意 Bash/`curl` 命令同样不透明重放；失败作为工具结果交回模型，由模型结合命令语义决定下一步。

## 运行中输入与取消

运行中只有三个不同动作：

- `follow-up` 调用 `steer()`，在当前 turn 的下一个安全 model boundary 进入上下文；
- `next-turn` 调用 `queue()`，等待当前任务终答后创建下一 turn；
- Stop/interrupt 使用宿主的 AbortSignal，取消当前执行，不伪装成一条输入。

每个 turn 只有一个 `RuntimeInputQueue`。SDK 在 model step 接收消息时确认投递，按 id 返回 `steering-message`。准备阶段也允许接收输入，因此 kernel 持有尚未结算的输入；准备失败或 turn 关闭时，尚未投递的输入以 `not-delivered` 结算，宿主随后可以结束 journal 写入。 `prepareStep` 改写 messages 时必须保留已接收的 steering message。 `not_delivered` 和 `unconfirmed` 都向用户可见，由用户决定是否重新提交。

普通用户 follow-up 不抢占正在采样的 response，也不抑制该 response 已生成的 tool call；AI SDK 在当前 step 及其工具完成后的安全 boundary 注入 steering message。这样与 Codex 的 user-input queue 一致：补充输入改变后续决策，但不会被解释成对原任务的停止。只有显式 Stop 使用 run AbortSignal。前端在 admission 成功后立即把补充投影到正文，并在官方 `steering-message` 以同一 id 到达时去重；该乐观投影不是 journal authority，刷新后仍以持久 input 状态和 stream 为准。

## Journal、模型上下文与压缩

PostgreSQL/SQLite journal 是唯一可重建的会话事实源。provider response id 只是同 provider/model 且与 journal 直接相邻时可用的优化；切换模型、分支、cursor 缺失、lineage 不匹配或到达水位后都从 journal 重建。不能把 provider cursor、Redis replay 或内存中的 `ToolLoopAgent` 当作历史。

shared context manager 将完整 UIMessage journal 投影为 bounded ModelMessage：

1. 有效输入窗口为 `max(512, contextWindow - maxOutputTokens - 8000)`；自动压缩水位取有效输入窗口、模型上下文窗口的 90% 和显式模型水位三者的最小值。stored lineage 到达水位时从 journal 重建。这个水位同时是 UI 的 `autoCompactAt` 和 context manager 开始拆分 prefix/tail 的依据，不能出现 lineage 已断开但投影仍不压缩的不同阈值。
2. 近期 tail 保留原生消息，并在自动压缩水位内为 compacted prefix 预留 6000 tokens；只压缩旧前缀。单条超长 prefix 消息按连续 chunk 全量送给 compactor；工具与 `data-*` 的大 payload 可以有界截断，保留调用 ID、首尾内容和截断标记。最终 ModelMessage 投影若仍超过有效输入窗口就拒绝调用，不能依赖 provider 隐式截断。
3. Cloud 对 OpenAI 一方 Responses 端点使用 `compaction_trigger`，以 `store: false` 请求和重放加密的 `compaction` item。checkpoint 绑定 provider 和 model；切换后从完整 journal 投影。Ark stored Responses 只有在 `previous_response_id` 与 journal 直接相邻时才发送最后一个 assistant 之后的 user/tool suffix；lineage 缺失时移除旧 `itemId` 并物化完整本地 prompt，禁止发送悬空 `item_reference`。其他端点和 Desktop relay 采用流式文本压缩，增量合并旧摘要和新 prefix，持久化 `runtime-context-v1`。
4. checkpoint 记录 `coveredThroughMessageId` 和 revision。两端先完成近期消息转换、输入窗口校验与取消检查，再由 PostgreSQL/SQLite 通过 CAS 安装；compaction 或 checkpoint 写入失败会终止本次主模型调用，不能假装压缩成功或推进 coverage。Cloud 和 Desktop 在 SDK 的 `finish-step` 将包含 artifacts 的消息 parts 写入当前助手消息。Cloud 以 turn 租约约束写入，终态复用同一 item 和 ordinal。轮内压缩覆盖完整工具步骤时，checkpoint 记录输入消息、助手消息和该步的工具调用 ID。恢复时校验所选分支、工具完成状态和远程模型绑定，随后重放保留的用户输入和剩余步骤。缺失或不匹配时重新投影原始 journal。
5. 文件授权/字节加载是 host 的 `prepareRecent` adapter；shared manager 不访问 Storage、数据库或本地文件系统。持久 journal 从不因 projection/pruning/compaction 被改写。

ContextUsage 表示最近一次活动模型上下文，不是会话累计花费：优先采用 provider 返回的 input usage，加上会留在后续上下文中的非 reasoning 输出；provider 尚未返回可靠 usage 时使用同一 portable estimator 并标记 `estimated`。分类始终是估算，分类和等于展示总量。Cloud 从 step snapshot 暴露该值，Desktop 在同一 model middleware/onStepEnd 边界持久化到 thread；两端都展示原始 model window、自动压缩水位和是否已有 checkpoint，且压缩不会删除原始 journal。

Desktop relay 不使用 stored provider lineage，但使用同一个 journal projection、budget 和 checkpoint 机制。其 authority 是每个 identity scope 下的 `runtime.sqlite`，schema 为 `threads`、`turns`、`items`、`context_checkpoints`、`turn_plugin_snapshots`，`user_version=1`。旧 `runtime-v1.sqlite`、`sessions.sqlite` 和 Electron `userData` journal 不读取、不迁移、不覆盖；这是明确的零兼容切换。

## 工具 runtime

工具 schema/description 是输入和局部规划约束的事实源。前置条件与限制附着在对应 manifest，core instructions 不复制一套工具路由或产品工作流。`ToolOutcome`、native approval、UI metadata 和 streaming semantics 保持 AI SDK 原语。

模型初始步骤保持小而稳定的热工具面：执行环境始终直接提供 `bash`、`read_file`、 `apply_patch`、`write_file`，公共 registry 直接提供单次 `web_search`/`web_fetch`、 `tool_search`、`ask_user` 与 `update_plan`，宿主保留明确的 artifact publication。Code Mode、subagents、Runtime Media/Memory、source refresh 和 plugin/MCP 等低频或大 schema 能力标记 `deferLoading`，由 AI SDK 原生 `tool_search` 在需要时激活；它们仍属于同一个冻结 catalog，不是第二套 capability profile。Skill loader 因 `<available_skills>` 会直接要求它而保持可见。延迟加载只减少无关 schema 和选择歧义，不改变授权、审批、执行或可用能力。

`bash({command})` 返回退出码或可继续交互的 `session_id`；后续仍调用同一个 `bash({session_id,stdin?})` 写入终端或轮询增量输出，不向模型暴露第二个进程工具。PTY 输入、进程所有权、审批、取消与句柄回收仍遵循 Codex 式执行内核。模型用 `max_output_tokens` 控制输出预算，默认 10,000；超过保留窗口时返回截断提示。桌面终端归 Thread 所有，正常 Turn 结束后可接回；停止会话、切换执行权限、删除会话或宿主退出会撤销句柄。云端 guest 仍按 Turn attempt 分配，结束时冻结工作区，持久化实际 checkout 中的变更后回收。显式交付文件与普通工作文件共用文件身份和写入检查。

SDK 可以并发发出 tool call，但实际执行必须经过每个 catalog 实例的 `ToolExecutionScheduler`：

- 默认工具独占，只有 manifest 明确 `planning.parallelizable: true` 才共享读 admission；
- 排队顺序公平，独占项形成 barrier，后到的并行调用不能越过；
- 排队期间的 AbortSignal 会在执行前移除 waiter，已取得 admission 的操作在 `finally` 释放；
- async iterable 工具必须声明 `policy.streaming`，scheduler 持有 admission 直到 terminal yield；
- duplicate tool name 启动即失败，不允许宿主静默替换 shared capability。

ToolLoop 中间件不通过删除 provider tool call 来制造串行；并发、权限和副作用边界在 executor admission 执行。Portable registry 只含已证明跨 Backend/Desktop 共用的基础能力。Runtime 自有的 Media、Memory 作为 host manifest；Knowledge、Canvas 和外部 MCP 都通过同一套 catalog/release/ installation/activation/Turn snapshot/connection lifecycle 注入，Runtime 不再持有固定服务 tool client 或第二套插件 adapter。完整 ownership、去密持久化、lazy discovery、MCP fail-closed 与当前仅 `knowledge_search`/`get_canvas_context` 的能力面见 [Agent plugins](agent-plugins.md)。

## Instructions 与 runtime facts

system instructions 在一个 turn 内固定。核心基座采用 Codex 式执行不变量：服从当前请求、持续工作到完成或真实阻塞、工具与外部内容不升级为指令、权限失败不可绕过、完成必须有观察证据；表达采用 Pi 式极简结构，不复述工具清单、路由手册或逐工具教程。其余只注入已批准 Skill/Memory 和日期。HTML、图表、搜索数量、交付模板、工具调用顺序等产品 workflow 不属于 core prompt；需要的约束放进 Skill 或 tool declaration。

`<execution_environment>` 是 turn snapshot，由 shared renderer 从宿主结构化 capability 生成。运行中 workspace change 是 transcript 中的 `<runtime_context type="workspace_changes">` user-role runtime fact，不修改 system prompt，也不冒充新的产品用户请求。路径是不可信数据；模型只重读与当前任务相关的文件。

## 取舍与一手证据

采用的基线来自本地 `openai/codex` 当前实现中的 session/turn/input queue/conversation history/ tool runtime 责任；其 Rust crate/module 分局只用于追踪语义 owner，不是 TypeScript 布局约束。插件治理与执行边界由 [Agent plugins](agent-plugins.md) 单独维护。公开依据包括 [Codex harness](https://openai.com/index/unlocking-the-codex-harness/) 和 [App Server](https://developers.openai.com/codex/app-server/) 的 Thread/Turn/Item 模型。Pi 侧以本地 `~/projects/pi` 的 `earendil-works/pi@edfe6b2ef32283d31efc9e26db86fe48be19d3b2` 为核对快照，采用 [coding-agent tools](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/src/core/tools) 的极简热工具面、文件专用 schema 和 Bash 尾部观察窗口，不复制其 loop、权限或 host filesystem 假设。另以 Anthropic 公开的 [agent loop/subagent guidance](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop) 校验 prompt/context 边界。Codex 的 Rust loop、provider protocol、approval wire format 和产品提示词不复制，许可证受限文本不进入本仓库。

与 Codex 的主要有意差异是：实际 loop、消息、approval、stream 和 tool execution 仍由本仓库已采用的 [Vercel AI SDK `ToolLoopAgent`](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent) 提供；shared kernel 只实现 SDK 没有拥有的 Session/Turn control-plane boundary。云端与本地使用不同持久化/隔离 adapter，但遵守同一 lifecycle contract。

被否决：按 Codex crate 做目录级复刻、一个 npm package 内保留多个嵌套 `src`、将实现路径作为公开 API、保留旧 `agent/` facade、host 各自维护 loop/context、中央 prompt 编排工具、provider cursor 作为事实源、静默压缩失败、通过 middleware 丢弃 tool call、为了迁移旧 SQLite 建双轨 adapter。

## 实现与验证边界

- shared kernel：[public API](../../packages/agent-runtime/src/index.ts)、[RuntimeTurn](../../packages/agent-runtime/src/turn/turn.ts)、[context projection](../../packages/agent-runtime/src/context/history.ts)、[tool scheduler](../../packages/agent-runtime/src/tools/scheduler.ts)
- Backend host：[run](../../apps/backend/services/runtime/src/application/agent/runs/run.ts)、[cloud turn](../../apps/backend/services/runtime/src/application/agent/runtime/cloud-turn.ts)、[model context](../../apps/backend/services/runtime/src/application/agent/context/model-context.ts)
- Plugins：[plugin lifecycle](agent-plugins.md)、[shared manager](../../packages/agent-runtime/src/plugins/manager.ts)、[Runtime catalog](../../apps/backend/services/runtime/src/application/agent/tools/catalog.ts)
- Desktop host：[session manager](../../apps/frontend/apps/desktop/electron/runtime/session-manager.ts)、[journal](../../apps/frontend/apps/desktop/electron/runtime/journal.ts)

最低验证包括 shared、Backend、Desktop tests/typecheck/build，checkpoint 冲突、queued tool cancel、turn 资源只释放一次、steer/queue、非抢占式 follow-up、interrupted recovery 和 host finalizer。PostgreSQL/Redis integration skip、真实 provider、Docker/gVisor/Kubernetes、macOS 版本矩阵和发行签名仍是独立环境验收，不能由 mock 单测或类型检查替代。
