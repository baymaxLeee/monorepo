# Chat Agent

本目录以 AI SDK 7 `Agent` interface 为稳定边界。Chat 只有一个通用主 Agent；执行机制由 runtime 决定，业务行为由 profile、context、tools 和 policy 组合，不按用户语义复制 Agent。

```text
agent/
├── agents/          # Agent factory、ToolLoop 实现
├── profiles/        # normal、plan 等行为配置；不是独立 Agent
├── context/         # UIMessage → bounded ModelMessage、instructions、compaction
├── tools/           # 薄 tool adapters；files 统一读写与 artifact 能力
├── integrations/    # MCP、Skills 等 instructions/tools 扩展
├── runs/            # run 编排、lease/cancel、trace persistence
├── streams/         # Redis-backed UIMessage SSE transport resume
├── memory/          # durable memory 与 extraction
├── providers/       # provider/model adapter
└── observability/   # product run/step/tool lifecycle
```

## Runtime policy

- `ToolLoopAgent` 是当前默认且唯一启用的交互 runtime（Brain）。
- 必须跨进程、部署、重试或长时间等待后恢复的工作**不会**塞进主 ToolLoopAgent。它们委派给独立的 `executor` 服务（真实的 Workflow DevKit，`apps/backend/services/executor`），通过 `@backend/transport-ts` 的 `ExecutorInternalClient` 非阻塞地起一个 task 就返回。 `delegate_tasks` 是文件 materialization 的例子，详见 `agent_task_执行时服务` plan 与 `apps/backend/services/executor/AGENTS.md`。
- Runtime 在 run 开始前由 profile/policy 明确选择并持久化，模型不能自行切换 runtime。

## Context and tools

- AI SDK `runtimeContext.orchestration` 只保存运行所需的少量编排快照；视为 immutable， `prepareStep` 仅处理显式 Plan 读取等边界，不维护 HTML verification 或 exact-tool 状态机。tool callbacks 只做 telemetry，不得改写编排状态。
- 每个 tool 通过自己的 `contextSchema` 获得最小权限数据，不共享万能 ToolContext。
- 内置 function tool 的 Zod Schema 是唯一输入契约：字段说明、strict calling 和 compact `inputExamples` 随 tool definition 发送，不在 instructions 复制 payload。 `repairToolCall` 只记录 Schema 前的拒绝并返回 `null`；主 Agent 在下一 step 自行决定是否修正，runtime 不调用隐藏 repair model。
- `tools/` 只放模型调用边界；artifact、memory、plan 的业务实现属于各自 subsystem。
- `ToolCatalog` 是可实例化对象。默认 catalog 只作为应用 composition root，禁止模块级数组泄漏租户状态。
- 新 run 的 context projection 将历史 `write_file`/`edit_file`/`delegate_tasks` 压缩为路径、SHA、task id 和失败事实；不把大正文、旧 edit 参数或无效 Schema 调用重新示范给模型。持久化 UIMessage 不变。
- Skills 可以贡献 instructions 和 tools；MCP 必须显式筛选工具/schema，不能直接暴露远端全集。
- 系统 Skill 采用渐进披露：初始 prompt 只含 name/description，命中后由通用 `load_skill` 读取代码版本化的 `SKILL.md`。纯工作流、证据规则和输出模板属于 Skill，不为此新增垂直业务 tool。
- Subagent 通过 tool delegation 运行独立 context，并将压缩后的 `toModelOutput` 返回主模型。

## Persistence boundaries

- Thread/message persistence：恢复业务会话。
- Redis UIMessage SSE：浏览器刷新、断网和切换会话后的 transport resume。
- Workflow/Harness session：进程崩溃、部署或长期等待后的 execution resume。

三者不能混为一种“断点续传”。浏览器断开只移除 subscriber；只有显式 cancel 才终止 run。
