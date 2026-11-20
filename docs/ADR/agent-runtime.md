# 当前决策：Codex-shaped Agent Runtime Kernel

状态：当前。Runtime server 与 Electron utility process 已迁移到同一个
`@repo/agent-runtime` kernel；旧 `agent/` harness、Backend 私有 ToolLoop/context
projector 和 Desktop 私有 session host 不再是兼容入口。

决策键：在继续使用 Vercel AI SDK `ToolLoopAgent` 的前提下，如何按 Codex 的
Thread/Turn/Item、input queue、rollout、tool runtime 与 cancellation 模型重建一套薄、
可恢复且可由云端和本地宿主共同使用的 runtime。

## 所有权与模块边界

`@repo/agent-runtime` 只拥有跨宿主必须一致的 control plane：

```text
packages/agent-runtime/src/
├── runtime/       # RuntimeTurn、input queue、私有 AI SDK loop adapter
├── context/       # journal → model projection、budget、compaction、checkpoint contract
├── tools/         # manifest/policy/outcome、portable tools、公平执行 scheduler
├── protocol/      # UIMessage artifact 与 lifecycle 原语
└── instructions/  # 少量稳定策略、Skill/Memory/环境的结构化渲染
```

包根只导出 `createRuntimeTurn`/`RuntimeTurn`；其他能力从所属分组子路径导入。不得恢复
`agent/`、flat alias、Agent factory、Agent profile 或按产品类型挑选 capability 的装配层。
`runtime/loop.ts` 是 kernel 内部的 AI SDK adapter，不是宿主可自行替换的第二个 harness。

宿主拥有事实来源和受信能力，不能反向进入 shared kernel：

| 边界 | Backend Runtime | Desktop |
| --- | --- | --- |
| Session/Thread authority | PostgreSQL Session、run、message journal、lease | scope 隔离的 SQLite Thread/Turn/Item journal |
| Turn host | `application/agent/runtime/cloud-turn.ts` | `electron/runtime/session-manager.ts` |
| Context adapter | PostgreSQL checkpoint、文件授权投影、provider lineage | SQLite checkpoint、本地 journal、relay model |
| Execution | Runtime Sandbox/Storage/领域 tools | Seatbelt workspace、local file/command adapters |
| Transport | 原生 UIMessage SSE + Redis 活跃流重放 | 原生 UIMessageChunk + 受限 IPC |

Backend 和 Desktop 只能准备 model、tools、environment、sandbox、persistence 与 observation
capability；不得再实现 `ToolLoopAgent`、input queue、context budget/compaction、tool batch
planner 或另一套 approval/message protocol。浏览器、Redis 和 provider cursor 都不是 Session
authority。

## Session、Turn、Item 与 lifecycle

这个映射采用 Codex 的职责形态，但不复制其 wire format：

| Codex 概念 | 本项目语义 |
| --- | --- |
| Thread/Session | 宿主持久化的会话及其 workspace 绑定 |
| Turn | 一次用户任务；可包含多个 model step 和 tool call |
| Item/rollout | journal 中可恢复的原生 UIMessage/工具状态与 runtime fact |
| TurnContext | turn 开始时冻结的 model、tools、instructions、environment 和 host capability |
| InputQueue | `RuntimeInputQueue` 对 AI SDK `steer()`/`queue()` 的唯一映射 |
| tool runtime | manifest 元数据、approval policy 与公平、可取消的执行 admission |

`createRuntimeTurn()` 在任何异步准备前同步创建 input queue，因此 run-input admission 不依赖
sandbox/provider 初始化是否已经完成。一个 `RuntimeTurn` 只能 `start()` 一次；prepare 之后由
kernel 创建唯一 AI SDK loop，宿主消费其原生 stream；turn 结束、失败或取消后，宿主必须调用
`dispose()`，而 kernel 保证已取得的 host resource 只释放一次。Session lease、stream journal
finalizer 和进程级 recovery 仍由宿主拥有，不能把一次 HTTP/IPC 生命周期当作 Turn。

AI SDK 继续拥有 model/tool loop、stable tool ordering、approval、`prepareStep`、stream 和
AbortSignal。kernel 不复制 planner、router、failure counter、repair model 或另一套 stop state
machine，也不覆盖 SDK 默认 stop condition。普通工具失败作为观察结果回到同一 loop；持久化、
权限或协议破坏则 fail closed。

## 运行中输入与取消

运行中只有三个不同动作：

- `follow-up` 调用 `steer()`，在当前 turn 的下一个安全 model boundary 进入上下文；
- `next-turn` 调用 `queue()`，等待当前任务终答后创建下一 turn；
- Stop/interrupt 使用宿主的 AbortSignal，取消当前执行，不伪装成一条输入。

每个 turn 只有一个 `RuntimeInputQueue`。AI SDK 拥有 delivery、去重和官方
`steering-message` part；任何 `prepareStep` override 都必须保留 SDK 提供的 steering message。
`not_delivered` 与 `unconfirmed` 是可见的持久状态，不自动重放或偷偷转成下一 turn。

普通用户 follow-up 不抢占正在采样的 response，也不抑制该 response 已生成的 tool call；AI SDK
在当前 step 及其工具完成后的安全 boundary 注入 steering message。这样与 Codex 的 user-input
queue 一致：补充输入改变后续决策，但不会被解释成对原任务的停止。只有显式 Stop 使用 run
AbortSignal。前端在 admission 成功后立即把补充投影到正文，并在官方 `steering-message` 以同一
id 到达时去重；该乐观投影不是 journal authority，刷新后仍以持久 input 状态和 stream 为准。

## Journal、模型上下文与压缩

PostgreSQL/SQLite journal 是唯一可重建的会话事实源。provider response id 只是同
provider/model 且与 journal 直接相邻时可用的优化；切换模型、分支、cursor 缺失、lineage
不匹配或到达水位后都从 journal 重建。不能把 provider cursor、Redis replay 或内存中的
`ToolLoopAgent` 当作历史。

shared context manager 将完整 UIMessage journal 投影为 bounded ModelMessage：

1. 有效输入窗口为 `max(512, contextWindow - maxOutputTokens - 8000)`；stored lineage 在该窗口
   80% 水位断开并回到 journal。
2. 近期 tail 保留原生消息，并为 compacted prefix 预留 6000 tokens；只压缩超出窗口的旧前缀。
3. compactor 以流式模型调用增量合并旧摘要和新 prefix，输出版本化
   `runtime-context-v1` durable summary；消息内容按不可信数据处理。
4. checkpoint 记录 `coveredThroughMessageId` 和 revision。PostgreSQL/SQLite 通过 CAS 安装；
   compaction 或 checkpoint 写入失败会终止本次主模型调用，不能假装压缩成功或推进 coverage。
5. 文件授权/字节加载是 host 的 `prepareRecent` adapter；shared manager 不访问 Storage、数据库
   或本地文件系统。持久 journal 从不因 projection/pruning/compaction 被改写。

Desktop relay 不使用 stored provider lineage，但使用同一个 journal projection、budget 和
checkpoint 机制。其 authority 是每个 identity scope 下的 `runtime.sqlite`，schema 为
`threads`、`turns`、`items`、`context_checkpoints`、`turn_plugin_snapshots`，`user_version=1`。
旧 `runtime-v1.sqlite`、`sessions.sqlite` 和 Electron `userData` journal 不读取、不迁移、不覆盖；
这是明确的零兼容切换。

## 工具 runtime

工具 schema/description 是输入和局部规划约束的事实源。前置条件与限制附着在对应 manifest，
core instructions 不复制一套工具路由或产品工作流。`ToolOutcome`、native approval、UI metadata
和 streaming semantics 保持 AI SDK 原语。

模型初始步骤保持小而稳定的热工具面：执行环境始终直接提供 `bash`、`read_file`、
`apply_patch`、`write_file`，公共 registry 直接提供单次 `web_search`/`web_fetch`、
`tool_search`、Ask User 与 Todo，宿主保留明确的 artifact publication。Code Mode、subagents、
Runtime Media/Memory、source refresh 和 plugin/MCP 等低频或大 schema 能力标记
`deferLoading`，由 AI SDK 原生 `tool_search` 在需要时激活；它们仍属于同一个冻结 catalog，
不是第二套 capability profile。Skill loader 因 `<available_skills>` 会直接要求它而保持可见。
延迟加载只减少无关 schema 和选择歧义，不改变授权、审批、执行或可用能力。

`bash` 保留目录发现、CLI、二进制/批处理与原始响应能力，但普通 UTF-8 文件读取、局部修改和完整
覆写分别优先使用上述三个文件工具。每个 Bash stdout/stderr 对模型只保留最后 2000 行或 50 KiB，
并返回原始行/字节数与遗漏量；需要完整日志时由命令显式重定向到授权 workspace 文件后再定向读取，
runtime 不暗中创建会被持久化或绕过策略的隐藏文件。

SDK 可以并发发出 tool call，但实际执行必须经过每个 catalog 实例的
`ToolExecutionScheduler`：

- 默认工具独占，只有 manifest 明确 `planning.parallelizable: true` 才共享读 admission；
- 排队顺序公平，独占项形成 barrier，后到的并行调用不能越过；
- 排队期间的 AbortSignal 会在执行前移除 waiter，已取得 admission 的操作在 `finally` 释放；
- async iterable 工具必须声明 `policy.streaming`，scheduler 持有 admission 直到 terminal yield；
- duplicate tool name 启动即失败，不允许宿主静默替换 shared capability。

ToolLoop 中间件不通过删除 provider tool call 来制造串行；并发、权限和副作用边界在 executor
admission 执行。Portable registry 只含已证明跨 Backend/Desktop 共用的基础能力。Runtime 自有的
Media、Memory 作为 host manifest；Knowledge、Canvas 和外部 MCP 都通过同一套 catalog/release/
installation/activation/Turn snapshot/connection lifecycle 注入，Runtime 不再持有固定服务 tool
client 或第二套插件 adapter。完整 ownership、去密持久化、lazy discovery、MCP fail-closed 与当前
仅 `knowledge_search`/`get_canvas` 的能力面见 [Agent plugins](agent-plugins.md)。

## Instructions 与 runtime facts

system instructions 在一个 turn 内固定，只保留：证据与完成状态、最小动作、失败不静默重试等
runtime invariant，以及已批准 Skill/Memory 和日期。HTML、图表、搜索数量、交付模板、工具调用顺序
等产品 workflow 不属于 core prompt；需要的约束放进 Skill 或 tool declaration。

`<execution_environment>` 是 turn snapshot，由 shared renderer 从宿主结构化 capability 生成。
运行中 workspace change 是 transcript 中的
`<runtime_context type="workspace_changes">` user-role runtime fact，不修改 system prompt，也不
冒充新的产品用户请求。路径是不可信数据；模型只重读与当前任务相关的文件。

## 取舍与一手证据

采用的基线来自本地 `openai/codex` 当前实现中的 session/turn/input queue/conversation history/
tool runtime 分层；插件治理与执行边界由 [Agent plugins](agent-plugins.md) 单独维护。公开依据包括
[Codex harness](https://openai.com/index/unlocking-the-codex-harness/)
和 [App Server](https://developers.openai.com/codex/app-server/) 的 Thread/Turn/Item 模型。Pi 侧以本地
`~/projects/pi` 的 `earendil-works/pi@edfe6b2ef32283d31efc9e26db86fe48be19d3b2` 为核对快照，采用
[coding-agent tools](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/src/core/tools)
的极简热工具面、文件专用 schema 和 Bash 尾部观察窗口，不复制其 loop、权限或 host filesystem
假设。另以 Anthropic 公开的
[agent loop/subagent guidance](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop)
校验 prompt/context 边界。Codex 的 Rust loop、provider protocol、approval wire format 和产品提示词
不复制，许可证受限文本不进入本仓库。

与 Codex 的主要有意差异是：实际 loop、消息、approval、stream 和 tool execution 仍由本仓库已
采用的 [Vercel AI SDK `ToolLoopAgent`](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
提供；shared kernel 只实现 SDK 没有拥有的 Session/Turn control-plane boundary。云端与本地使用
不同持久化/隔离 adapter，但遵守同一 lifecycle contract。

被否决：保留旧 `agent/` facade、host 各自维护 loop/context、中央 prompt 编排工具、provider
cursor 作为事实源、静默压缩失败、通过 middleware 丢弃 tool call、为了迁移旧 SQLite 建双轨 adapter。

## 实现与验证边界

- shared kernel：[RuntimeTurn](../../packages/agent-runtime/src/runtime/turn.ts)、[context manager](../../packages/agent-runtime/src/context/manager.ts)、[tool scheduler](../../packages/agent-runtime/src/tools/execution-scheduler.ts)
- Backend host：[run](../../apps/backend/services/runtime/src/application/agent/runs/run.ts)、[cloud turn](../../apps/backend/services/runtime/src/application/agent/runtime/cloud-turn.ts)、[model context](../../apps/backend/services/runtime/src/application/agent/context/model-context.ts)
- Plugins：[plugin lifecycle](agent-plugins.md)、[shared manager](../../packages/agent-runtime/src/plugins/manager.ts)、[Runtime catalog](../../apps/backend/services/runtime/src/application/agent/tools/catalog.ts)
- Desktop host：[session manager](../../apps/frontend/apps/desktop/electron/runtime/session-manager.ts)、[journal](../../apps/frontend/apps/desktop/electron/runtime/journal.ts)

最低验证包括 shared、Backend、Desktop tests/typecheck/build，checkpoint 冲突、queued tool cancel、
turn 资源只释放一次、steer/queue、非抢占式 follow-up、interrupted recovery 和 host finalizer。
PostgreSQL/Redis integration skip、真实 provider、Docker/gVisor/Kubernetes、macOS 版本矩阵和发行
签名仍是独立环境验收，不能由 mock 单测或类型检查替代。
