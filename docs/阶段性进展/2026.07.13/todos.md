# Agent Runtime Context 重构

记录日期：2026-07-13

## 目标边界

- `instructions`：只承载 Core Policy、Runtime Contract、Skill/Bot 配置、轻量 Tool 编排、可选的低权威长期记忆和 Step 级质量门。
- `tools`：承载当前 Step 可调用 Tool 的 `name / description / inputSchema`。
- `messages`：承载用户请求、file parts、历史消息、必要的历史压缩替代物，以及 Agent Loop 的 Tool Call / Tool Result。
- `runtimeContext / toolsContext`：只作为宿主侧状态和执行依赖，不直接发送给模型。

## 事实基准（2026-07-13 核对源码：`ai@7.0.15`、`@ai-sdk/provider@4.0.2`）

分层 review 得到的确定性事实，作为后续重构的锚点：

- **AI SDK 开发者 API 层**：`streamText` / `ToolLoopAgent` 确实把 `instructions`、`messages`、`tools` 暴露为三个独立入参（index.d.ts `streamText` 签名逐一列出）。这一层"三入参"划分是确定性事实。
- **Provider 协议层**：`LanguageModelV2CallOptions` 只有 `prompt: Array<LanguageModelV2Message>` + `tools` + 控制参数；`instructions/system` 被 SDK 归一化为 `prompt` 数组里一条 `{ role: "system" }` 消息（`LanguageModelV2Prompt = Array<LanguageModelV2Message>`）。物理层只有两条内容通道（`prompt` 含 system + `tools`），**不是三条**。
- **重构含义**：
  - 目标不是"给内容找对物理管道"（物理上只有两条），而是让高权威 system 前缀保持**稳定**（信任分层 + Provider prompt caching），把易变的世界状态（summary / state / todo / plan / document metadata）挤出 system 前缀、进入随对话增长的 message 数组。这与下方"目标边界"完全一致，且给出了源码级理由。
  - 历史压缩替代物必须是真实 `ModelMessage`（`role: system` 或 `user`，依 Provider 适配行为确定），**不得新增私有 Provider 通道**。
  - 文档 `techloge-shar.md` 第 3 章"三条物理输入管道"措辞 overclaim，需澄清为"AI SDK 请求构造层的三个入参"，并说明 provider 物理层是 `prompt(含 system) + tools` 两条。

## 已发现的问题

- [ ] Referenced Document Metadata 重复注入：用户 file part 已在 `transformUserFilePartsForModel()` 中转换成图片或 `<document_reference>`，`loadInstructionContext()` 又把相同文档 Metadata 注入 `<context_data>`。
- [ ] Conversation Summary / Structured State 被放进 `instructions`：它们属于历史压缩结果，不应该获得 system 级语义，也会破坏稳定 Prompt Prefix。
- [ ] Current Todo Snapshot 被放进 `instructions`：`update_todos` 的 Tool Call / Tool Result 已存在于消息轨迹，前端也会根据后续交付 Tool 状态计算有效进度。
- [ ] Active Plan 正文被放进 `instructions`：Plan 已有 Document 真源、Revision 和 Message 引用，不应每个 Run 将完整正文复制进系统指令。
- [ ] Core Policy / Execution Protocol 仍引用 `<current_todo_list>`、`<active_plan_artifact>` 和 Instructions 中的 referenced documents，删除注入路径时必须同步清理。

## 实施顺序

### 1. 删除重复的 Document Instructions 注入

- [ ] 从 `loadInstructionContext()` 删除 `listDocuments()`、`documentIds` 和 `documents` 装配。
- [ ] 删除 `ReferencedDocument` Instruction 类型以及 `renderDocuments()`。
- [ ] 保留并复核 file part → 图片 / `<document_reference>` 的 Messages 投影。
- [ ] 文档正文继续通过 `read_file` 按需、分片读取。

### 2. 将历史压缩从 Instructions 迁到 Messages

- [ ] `projectModelContext()` 不再返回 `conversation_summary` / `conversation_state` Instruction blocks。
- [ ] 仅当 older messages 因预算被裁掉时，生成有长度预算、低信任标记的压缩替代消息。
- [ ] 根据当前安装的 AI SDK 7 `ModelMessage` 类型与 Provider 适配行为确定合适的 message role，不新增私有 Provider 管道。
- [ ] 保留 `coveredThroughMessageId` 增量压缩，避免重复总结同一段历史。
- [ ] 确认 recent messages 未被裁剪时不会重复发送 Summary / State。

### 3. 删除 Todo Instructions 投影

- [ ] 删除 `latestCompletedToolOutput(..., "update_todos")` → `current_todo_list` 的投影路径。
- [ ] 删除 Instructions 中针对 `<current_todo_list>` 的规则。
- [ ] 复核同一 Run 内 Tool Result 回流、跨 Run UIMessage 持久化与前端有效状态计算。
- [ ] 如果未来确实需要跨 Run 恢复未完成任务，使用显式领域读取能力或 Workflow 状态恢复，不重新塞回系统提示词。

### 4. 删除 Active Plan 正文注入

- [ ] 删除 `activePlanDocumentId` → `getDocument()` → `active_plan_artifact` 的 Instructions 投影。
- [ ] 保留 `data-plan-execution` → `<referenced_plan>` 的 Message 转换。
- [ ] Plan 执行通过 Message 中的 Document ID 调用 `read_file` 获取正文。
- [ ] Plan 编辑流程只传递必要的 Document ID / Revision 引用，正文仍按需读取；保留 Revision compare-and-swap。
- [ ] 删除 Instructions 中针对 `<active_plan_artifact>` 的规则。

### 5. 收紧 Instruction Assembly

- [ ] 将 `InstructionContextBlock` 收敛为真正的指令类贡献，例如显式激活的 Skill。
- [ ] 决定 Active Memory 是否继续作为受数量和字符预算限制的低权威 Instructions overlay；无论放在哪条管道，都不得把 Memory 内容解释成命令。
- [ ] 删除失效的 `<context_data>` 子节点与对应 XML 渲染代码，不保留兼容分支。
- [ ] 保持 Core Policy / Runtime Contract 位于稳定前缀，动态 Step overlay 只由 `prepareStep()` 添加。

### 6. 重新捕获真实 Runtime

- [ ] 运行一次包含文本、文件、Tool Call、Tool Result 和多 Step 的真实 Run。
- [ ] 从日志分别确认 Provider Request 的 `instructions`、`tools`、`messages` 三条物理输入。
- [ ] 更新 `apps/backend/services/chat/src/agent/context/system-prompt.xml` 的真实英文 Instructions 和中文翻译。
- [ ] 更新 `techloge-shar.md` 第 2 章的真实 Runtime 示例，保证示例与实现完全一致。
- [ ] 修正 `techloge-shar.md` 第 3 章"三条物理输入管道"措辞：改为"AI SDK 请求构造层的三个入参"，并补一句 provider 物理层实为 `prompt(含 system 消息) + tools` 两条内容通道 + 控制参数。
- [ ] 复核第 3.2.1 节"聚合哪些 Runtime Context"表：重构后确认 instructions 侧不再列出 summary/state/todo/plan/document metadata，与代码一致。

## 验收标准

- [ ] 带文件的用户请求中，Document ID / filename 只通过 Messages 出现一次，Instructions 不再包含 referenced document metadata。
- [ ] recent messages 未发生裁剪时不生成 Summary / State；发生裁剪时，压缩替代物进入 Messages 且不覆盖最新约束。
- [ ] Instructions 不包含 `conversation_summary`、`conversation_state`、`current_todo_list`、`active_plan_artifact`。
- [ ] Tool Call / Tool Result 在同一 Run 的后续 Step 中仍以 ModelMessage 轨迹可追溯。
- [ ] Plan 执行和编辑仍能通过引用 + `read_file` 获得正确 Revision 的正文。
- [ ] Todo UI 的运行中、完成、失败和取消状态仍由 Tool 轨迹与领域状态正确计算。
- [ ] 对比重构前后的 Instructions token 数、稳定前缀长度和 Provider cache 命中指标。
- [ ] 文档与代码一致性：`techloge-shar.md` 不再宣称 provider 存在"三条物理管道"，且第 2 章真实捕获的 `core_policy` 不再残留 `<current_todo_list>` / `<active_plan_artifact>` 等已迁出的引用。
- [ ] 运行 chat service 的 scoped lint 与 build；本项目 DEMO 阶段不新增测试脚手架。
