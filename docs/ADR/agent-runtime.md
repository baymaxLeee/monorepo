# 当前决策：交互 Agent 与上下文

状态：当前。以 Chat 的 Agent factory、run、context 和 tool catalog 为实现入口。

## 执行与传输

Chat 使用 AI SDK 7 的 `Agent` interface 和一个 `ToolLoopAgent`；normal/plan 是
行为配置，不是互相交接的独立角色。SDK 拥有模型/工具循环，harness 只处理真实
边界：租约、权限、显式 Plan 读取、取消、上下文与持久化。

PostgreSQL UIMessage 是语义会话记录；Redis 保存原生 UIMessage SSE，负责浏览器
断网后的 transport resume；Executor Workflow 负责跨进程的 execution resume。
三者不可混同。断开浏览器只释放 subscriber；显式 Stop 才传播 AbortSignal，
收口未完成工具为官方 error 状态、取消未完成 todo，并等待 run finalizer。

Executor 状态经内部 SSE 汇入原生 preliminary tool results，浏览器仍消费同一
条 Chat UIMessage 流。trace 持久化失败不阻断生成。自定义 part 必须遵守
[stream 契约](../../schemas/streaming/chat-uimessage-stream.md)。

## 上下文与权限

Instructions 使用代码拥有的固定层次：稳定策略、模式/执行契约、能力投影、
Skill、结构化 Bot profile、已批准记忆与服务端环境。Tool schema 是输入契约；
历史会话、todo、Plan 内容不伪装成系统指令。配置字符串的转义不等于权限控制，
可用工具、scope 和审批仍由代码验证。

UIMessage 到 ModelMessage 的投影保留近期原生语义，预算不足才增量压缩旧前缀。
摘要记录覆盖位置并以 revision CAS 写入；失败不推进未完成的覆盖范围。
历史文件写入保留路径、SHA、结果和失败事实，不重复大正文与旧工具参数。

每个使用可变权威信息的 run 从所属服务读取最新 Plan、已发布 Skill 和配置。
历史搜索结果是证据，只有刷新/最新需求且现有证据不足时重新查询。
Skill 初始仅暴露名称/描述，激活后按需读取资源；草稿不进入执行上下文。
显式 Plan 执行必须先完整读取选中文件；自然语言执行由 agent 用文件工具发现。

## 工具与模型

- `ask_user` 是无 server execute 的 client tool，批量询问已知独立问题，客户端
  `addToolOutput` 后 continuation；依赖答案的后续问题再提出。
- 应用工具使用 ToolOutcome；业务失败可在 UI/persistence 保留结构化结果，同时
  向模型投影为 error-json。Abort、审批拒绝、输入/协议错误保留原生控制流。
  `toolSearch()` 保留原生结果以激活延迟工具。
- Bash 是每 run 独立内存 scratch，无主机挂载、环境注入和网络；结束或初始化
  失败销毁 session。Code Mode 只暴露公共 Web Fetch，不能绕过业务工具审批。
- 生成交付物按主 agent 计划串行；`delegate_tasks` 仅并发独立完整文件，冻结
  共享上下文，不创建另一套对话意图。todo 是官方工具结果中的替换快照。
- 文本模型使用 Admin 显式配置的 Responses dialect；不凭 URL 猜协议。
  支持存储续接的 provider 使用 response lineage，其他 provider 从本地 journal
  重放。provider cursor 不是唯一会话记录；媒体/embedding/rerank 使用各自 API。

## 取舍与事实源

薄 harness 减少重复调度与状态机，但持久任务、授权和取消仍需要明确代码边界。
不得把传输重连声称为主 agent 的进程崩溃恢复，也不增加隐藏 repair model。

实现：[run](../../apps/backend/services/chat/src/application/agent/runs/run.ts)、
[ToolLoop](../../apps/backend/services/chat/src/application/agent/agents/tool-loop.ts)、
[projector](../../apps/backend/services/chat/src/application/agent/context/projector.ts)、
[runtime tools](../../apps/backend/services/chat/src/application/agent/tools/builtins/runtime.ts)。
验证：`just test backend/chat`、`just test frontend/@repo/chat` 和受影响构建；流变更
同时验证生产者与 UI。依赖版本以 workspace catalogs/lockfile 为准。
