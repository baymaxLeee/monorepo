# Agent 工具调用可靠性执行计划

> 状态：已执行。Chat scoped lint/build、根级 lint/build、契约实例检查、
> `git diff --check` 与本地 `/healthz` 均通过。

## 结论

保留现有 `ToolOutcome`、`ToolIssue`、Manifest wrapper 和 AI SDK
`ToolLoopAgent` 主循环。当前问题不在执行期错误协议，而在执行前的工具输入生成、
模型上下文中的旧契约污染，以及观测对协议失败和语义失败的覆盖不完整。

本次采用“契约优先、主循环自愈、Harness 薄”的直接改造：

- 不新增通用工具顺序状态机。
- 不重做结构化错误协议。
- 不增加隐藏业务重试。
- 不默认调用第二个模型修复参数。
- 使用 AI SDK 原生 Schema、strict tool calling、input examples、ToolLoopAgent
  多步错误回灌和 `repairToolCall` 边界；`repairToolCall` 本轮仅记录执行前拒绝并返回
  `null`，让主 Agent 在下一 step 自主纠正。

## 证据与复核

### 当前设计

| 设计 | 结论 | 依据 |
|---|---|---|
| `ToolOutcome` + `ToolIssue` | 保留 | `manifest.ts` 已统一包装同步、Promise 和 AsyncIterable 执行结果；ADR-0042 已规定错误作为 observation |
| `ToolLoopAgent` 多步循环 | 保留 | AI SDK 会把无效工具调用反馈给后续模型 step，模型可自行改参 |
| `prepareStep` | 保持现状 | 只处理显式 Plan 读取硬边界；不得扩展成普通工具调度器 |
| same-step 并行 | 保留 | 独立工具由 SDK 并行；文件写入已有按 path 的 mutation queue |
| 自动 `repairToolCall` 模型调用 | 本轮不启用 | 真实会话中主 Agent 已能在下一 step 修正旧 `edit_file` 参数；立即增加隐藏模型调用缺少收益证据 |
| 历史工具调用完整回灌 | 收紧 | 成功和业务失败仍是有效证据；执行前 Schema 拒绝只会暴露旧参数，不应跨 run 继续污染 |

### 本地真实调用

- 数据库消息中发现 15 个 `AI_InvalidToolInputError` tool parts。
- 当前仍相关的失败包括：
  - `edit_file` 使用旧的平铺 `old_text/new_text`，而当前契约要求 `edits[]`。
  - `delegate_tasks.tasks[].output_path` 未放在 `root` 下。
  - `search_files` 对可选 `path` 传入空字符串。
- 多数其他失败来自已删除的 `write_html`、旧 `write_file`、HTML block 工具，
  说明破坏性工具重构后，最近历史中的旧参数形状会影响模型。
- `onToolExecutionStart` 只在输入通过 Schema 后触发，当前
  `agent_tool_calls` 无法统计执行前拒绝。
- `recordToolEnd` 会正确把 `ToolOutcome.ok=false` 记录为失败，但
  `tool-loop.ts` 的 Trace `agent.tool_success` 仍把所有 `tool-result` 标成成功。

### 官方与标杆对齐

- AI SDK `tool()` 原生提供 `inputSchema`、`strict`、`inputExamples`。
- AI SDK `addToolInputExamplesMiddleware` 可把示例注入不原生支持 examples 的
  Provider 描述，无需手写第二份 prompt 协议。
- AI SDK `repairToolCall` 是 `InvalidToolInputError` / `NoSuchToolError` 发生时的
  原生边界；返回 `null` 可保留原生失败流，不执行隐藏修复。
- Codex、Claude Code、Cursor 均采用小型通用工具集、模型主导循环、工具结果回灌，
  Harness 只保留权限、沙箱、并发和执行边界；不为普通调用顺序建立领域 workflow。

## 实施范围

### 1. 提升模型可见输入契约

- 为内置工具输入字段补齐简短、非重复的 Zod `.describe()`。
- 为容易误用的复杂契约增加一个最小 `inputExamples`：
  - `write_file`
  - `edit_file`
  - `delegate_tasks`
  - 其他有真实误用风险的批量或可选字段组合
- 通过 AI SDK `addToolInputExamplesMiddleware` 将这些示例投影给所有 Provider。
- 内置 function tools 默认 `strict: true`；外部 MCP/extension 工具保持其原始定义，
  避免替不受控 Schema 强行声明 strict。
- 可选根路径明确约定：省略或空字符串均表示全部/根目录，避免无语义差异的拒绝。

### 2. 记录执行前工具拒绝

- 在 `ToolLoopAgent.repairToolCall` 注册只读观测回调：
  - 记录 tool name、tool call id、step、受限 raw input 和错误类型。
  - 返回 `null`，不修改调用、不调用模型、不执行工具。
- 复用 `agent_tool_calls` 生命周期，不新增表和迁移。
- 对 raw string、`write_file.content` 和 `edit_file.edits` 统一有界截断，避免失败参数
  让 trace 或数据库膨胀。

### 3. 修正语义观测

- Trace `agent.tool_success` 同时检查 SDK execution result 和
  `ToolOutcome.ok`。
- `blocked`、`partial`、`failed` 均记录为语义失败，并保留
  `agent.tool_outcome_status`、`agent.tool_retryable`。
- 不改变 UIMessage ToolOutcome、前端卡片或模型 `error-json` 协议。

### 4. 清理跨 run 的旧写入参数示例

- 持久化消息保持不变，UI 和审计仍可看到失败调用。
- 投影给新 run 的模型上下文时，`write_file`、`edit_file` 和
  `delegate_tasks` 只保留 path、SHA、task id、替换数量和错误等语义结果，不再回灌
  可能过时且体积巨大的原始写入参数。
- 删除历史 `AI_InvalidToolInputError` / `AI_NoSuchToolError` 对应的
  `output-error` tool part。
- 同一 run 内仍由 AI SDK 原生循环看到失败并自行纠正。
- 成功、partial、blocked、failed 的工具结果全部保留；不做通用工具历史删除。

### 5. 文档收敛

- 更新 ADR-0023：内置工具使用 strict/schema examples；外部工具不被强制改写。
- 更新 ADR-0042：执行前输入拒绝保持原生控制流，但必须进入观测；不属于
  `ToolOutcome`。
- 更新 Chat 服务文档，明确 `repairToolCall` 是观测边界而非隐藏修复器。

## 明确不做

- 不为旧工具输入增加兼容 adapter 或 alias。
- 不自动把旧 `edit_file` 平铺参数改写成 `edits[]`。
- 不增加 exact-tool 强制调度、通用 prerequisite graph 或 verification gate。
- 不自动重试业务失败、Provider 生成或有副作用工具。
- 不新增测试文件、测试框架、数据库迁移或自定义 stream part。

## 验收

- [x] 内置工具的复杂输入在模型可见 Schema 中含字段说明和规范示例。
- [x] 内置 function tools 请求 strict calling；外部 extension/MCP 合约不被修改。
- [x] `InvalidToolInputError` 经官方 rejection hook 进入 `agent_tool_calls`，且原始
  输入被安全截断。
- [x] Schema 拒绝仍反馈给主 Agent，下一 step 可自行纠正；没有额外修复模型调用。
- [x] 新 run 不再接收历史文件写入参数或无效参数 tool part，但仍接收精简后的路径、
  SHA、task id 和失败事实。
- [x] Trace 不再把 `ToolOutcome.ok=false` 标为成功。
- [x] `just lint chat`、`just build chat`、根级 `just lint`、`just build` 和
  `git diff --check` 通过；Demo 阶段未新增或运行测试脚手架。

## 官方参考

- [AI SDK tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
- [AI SDK addToolInputExamplesMiddleware](https://ai-sdk.dev/docs/reference/ai-sdk-core/add-tool-input-examples-middleware)
- [Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
- [Claude Code tools](https://code.claude.com/docs/en/tools-reference)
- [Cursor tools](https://docs.cursor.com/en/agent/tools)
