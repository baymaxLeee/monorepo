# 通用 Plan / Todo List 与主 Agent 持久化方案

> 状态：设计待 review
> 范围：`apps/backend/services/chat`、`apps/backend/services/knowledge`、`apps/frontend/apps/chat`、`apps/frontend/packages/components`
> 核心技术栈：Vercel AI SDK 7、`WorkflowAgent`、Workflow SDK、AI Elements
> 首个接入场景：大型 HTML artifact 生成，但本规范不依赖 artifact
> 日期：2026-06-28

---

## 1. 目标与核心决策

Plan / todo list 是主 Agent 对复杂任务的结构化执行状态，而不是 HTML artifact 的附属进度条。它应适用于：

- 多轮研究、检索与总结；
- 编码、重构、诊断与验证；
- 多工具、长时间或可恢复任务；
- 文档、演示文稿、dashboard 和 HTML artifact 生成；
- 任何需要在后续 agent run 中继续执行的任务。

核心决策：

1. 保留顶层 `WorkflowAgent` 作为唯一 durable 主 Agent。
2. 删除 HTML artifact 专用 child workflow、轮询和独立 artifact stream。
3. 使用标准 `update_plan` tool call/output 持久化计划，不维护重复的 `data-plan` 真相源。
4. 每轮 run 从历史消息恢复最新 active plan，并显式注入主 Agent context。
5. 已完成 item、失败状态和结果引用必须跨刷新、跨 run、跨 context compaction 保留。
6. HTML 只是 plan 的一种执行任务：主模型生成每个 fragment，工具只负责校验、持久化和编译。
7. 用户可以编辑 pending todo；运行中编辑在当前 durable tool step 安全结束后转入新 run。

---

## 2. 主流 Agent 实践

### 2.1 Codex

Codex 将 plan 作为显式结构化能力维护，而不是从自然语言或 Markdown checkbox 猜测状态。计划更新使用完整 todo list，并明确 pending、in-progress 和 completed 状态。

采用原则：

- plan 更新是 tool protocol；
- 任务状态对用户可见；
- 已完成项不会因重新规划而静默丢失；
- plan 与实际执行工具分离。

### 2.2 Claude Code

Claude Code 会为复杂任务创建 task list，并让 task list 跨 context compaction 持久化；task list 不是一次模型响应中的临时文本。

采用原则：

- plan 必须可从持久化上下文恢复；
- compaction 前先提取 task state，不能依赖完整历史永远存在；
- 恢复时应给模型明确的当前计划，而不是要求模型重新推断。

参考：[Claude Code task list](https://code.claude.com/docs/en/interactive-mode)

### 2.3 Cursor

Cursor 的 Agent todo 支持依赖关系、实时更新、完成状态和用户直接编辑；新指令可以在当前任务执行期间转向后续工作。

采用原则：

- todo item 可以声明依赖；
- 用户能直接修改 pending item；
- Agent 对修改后的计划重新规划；
- UI 始终显示最新计划，而不是堆叠所有历史 revision。

参考：[Cursor planning](https://docs.cursor.com/en/agent/planning)

### 2.4 Vercel AI SDK / Workflow / AI Elements

- `WorkflowAgent` 将主 Agent loop 和 tool call 作为 durable workflow steps 保存，支持重试、刷新恢复和可观察性。
- `WorkflowChatTransport` 负责中断后的流恢复，不应再为 artifact 建第二套 workflow stream。
- `UIMessage.parts` 和 tool parts 是会话持久化的标准数据载体。
- `convertToModelMessages()` 默认不会把任意 custom data part 自动放进模型上下文，因此 active plan 必须显式恢复。
- `prepareStep` 和 `pruneMessages` 用于长 agent loop 的上下文压缩。
- AI Elements `Plan` / `Task` 负责可折叠、状态化、可滚动的计划展示。

参考：

- [WorkflowAgent](https://vercel.com/kb/guide/what-is-workflowagent)
- [convertToModelMessages](https://ai-sdk.dev/docs/reference/ai-sdk-ui/convert-to-model-messages)
- [pruneMessages](https://ai-sdk.dev/docs/reference/ai-sdk-ui/prune-messages)
- [AI Elements Task](https://elements.ai-sdk.dev/components/task)

---

## 3. 总体架构

```text
Conversation messages
  ├── user text / data-plan-edit
  ├── assistant text
  ├── tool-update_plan inputs + outputs   ← plan 持久化真相源
  └── other tool parts
          │
          ▼
buildAgentContext()
  ├── 读取最新有效 PlanSnapshot
  ├── 提取 completed / pending / result
  ├── 压缩历史 reasoning 和大体积 tool calls
  └── 注入 <active_plan> 到下一轮主 Agent context
          │
          ▼
WorkflowAgent（唯一 durable agent run）
  ├── update_plan
  ├── research / documents / other tools
  ├── begin_artifact
  ├── write_artifact_part
  └── publish_artifact
```

职责边界：

| 状态 | 真相源 |
|---|---|
| 用户可见 plan 与 todo 状态 | `tool-update_plan` output in assistant messages |
| 当前 run 的执行 journal、重试与恢复 | WorkflowAgent / Workflow SDK |
| run trace 与 tool observability | `agent_runs` / `agent_steps` / `agent_tool_calls` |
| artifact 正文、parts 与 revision | knowledge 服务 |
| 用户长期偏好 | memory subsystem，不存一次性 todo |

不新增独立 plan 数据表。跨 run 的 canonical plan 保存在会话消息；未完成 run 的最新 tool output 可从 `agent_tool_calls` 辅助恢复。

---

## 4. Plan 数据协议

### 4.1 PlanSnapshot

```ts
type PlanStatus = "active" | "completed" | "abandoned";

type PlanItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped";

type PlanResultRef = {
  kind: "artifact" | "document" | "file" | "url" | "tool" | "other";
  id?: string;
  label?: string;
  url?: string;
};

type PlanItem = {
  id: string;
  title: string;
  status: PlanItemStatus;
  description?: string;
  dependsOn?: string[];
  result?: PlanResultRef;
  error?: {
    message: string;
    retryable?: boolean;
  };
};

type PlanSnapshot = {
  schemaVersion: 1;
  planId: string;
  revision: number;
  goal: string;
  status: PlanStatus;
  items: PlanItem[];
  explanation?: string;
  updatedAt: string;
};
```

约束：

- `planId` 在一个逻辑任务生命周期内稳定。
- `revision` 由服务端递增；低 revision 更新拒绝为 conflict。
- item ID 创建后稳定，改名、重排和状态变化不改变 ID。
- `dependsOn` 只能引用同一 plan 中的 item，且不能形成环。
- completed item 不允许静默删除或回退；重新执行应创建新 item。
- plan completed 时不能存在 pending、in-progress 或 failed item。
- plan abandoned 表示用户切换到无关新目标，不表示删除历史。
- progress count 从 items 派生，不持久化重复的 total/done 字段。

### 4.2 update_plan

```ts
type UpdatePlanInput = {
  planId?: string;
  baseRevision?: number;
  goal: string;
  status: PlanStatus;
  items: Array<{
    id: string;
    title: string;
    status: PlanItemStatus;
    description?: string;
    dependsOn?: string[];
    result?: PlanResultRef;
    error?: PlanItem["error"];
  }>;
  explanation?: string;
};
```

行为：

1. 首次调用时服务端生成 `planId` 和 revision 1。
2. 后续调用必须携带 `planId + baseRevision`。
3. 服务端读取当前最高 revision，校验并返回新的完整 `PlanSnapshot`。
4. 纯状态推进可以省略 explanation；增删、拆分、合并或重排必须说明原因。
5. tool output 直接进入 WorkflowAgent 后续模型 context 和最终 assistant message。

完整快照优于 patch：

- workflow retry 天然幂等；
- 重连不依赖客户端是否收到过某个中间 patch；
- 每个 tool output 可以独立恢复；
- plan 体积远小于 artifact 正文。

---

## 5. Plan 创建与更新规则

### 5.1 何时创建

以下场景创建 plan：

- 用户明确要求计划或 todo list；
- 任务包含多个可验证阶段；
- 需要多个工具或可能跨 run；
- 任务可能被暂停、取消、编辑或恢复；
- Agent 在执行中发现原任务需要重新拆分。

简单问答、单次读取和明显的一步任务不创建 plan。

### 5.2 更新节奏

主 Agent 应在语义事件更新 plan：

- 复杂任务开始时；
- item 开始或一批并行 item 开始时；
- item 完成、失败或跳过时；
- 用户改变目标或编辑 todo 时；
- run 即将因 step guardrail 结束时；
- 整个 plan 完成或放弃时。

禁止按 token、日志行或任意百分比高频更新。

### 5.3 并行与依赖

- 没有依赖冲突的 item 可以同时 in-progress。
- 顺序任务通常只有一个 in-progress，但不设置全局单 active item 限制。
- Agent 只能启动依赖全部 completed/skipped 的 item。
- 一个并行批次完成后，用一次完整 `update_plan` 固化全部结果。

---

## 6. 跨 run Context 持久化与恢复

### 6.1 当前问题

当前 chat 已将 assistant `parts` 保存为：

```json
{ "version": 1, "parts": [] }
```

下一轮也会读取全部历史并调用 `convertToModelMessages()`。但 custom `data-*` parts 默认被过滤，因此“UI 能恢复”不代表“模型知道上次 plan 的进度”。

### 6.2 新的 buildAgentContext

启动每个 run 前：

1. 读取持久化 conversation messages。
2. 从所有完成的 `tool-update_plan` outputs 中按 `planId + revision` 选最新快照。
3. 如果取消时客户端 snapshot 比数据库旧，再从 `agent_tool_calls` 合并最新成功的 plan tool output。
4. 找到最新 `status=active` 的 plan。
5. 生成紧凑、确定性的模型上下文：

```xml
<active_plan id="..." revision="...">
  <goal>...</goal>
  <items>
    <item id="..." status="completed" result="artifact:...">...</item>
    <item id="..." status="pending">...</item>
  </items>
</active_plan>
```

6. 将该 projection 注入主 Agent instructions/context。
7. 再调用 `convertToModelMessages()` 和 `pruneMessages()` 构建普通历史。

恢复规则：

- completed item 永远不会因为历史裁剪而消失。
- pending/failed item 明确告诉下一轮 Agent 继续点。
- artifact/document/file 只注入引用和摘要，不注入完整正文。
- 用户消息明显属于当前目标时继续 active plan。
- 用户提出无关新目标时，主 Agent 先 abandoned旧 plan，再创建新 plan。
- 用户明确要求重做 completed item 时，新增一个新 item，而不是覆写历史完成状态。

### 6.3 Context 压缩

两层压缩：

**跨 run：**

- 提取 active plan 后再 prune 历史 reasoning。
- 删除较早的大体积 artifact 写入 tool calls。
- 保留近期用户/assistant 文本、必要工具结果和 active plan projection。

**同一 run：**

- 使用 `WorkflowAgent.prepareStep` 修改下一次模型调用的 messages。
- 已完成的 `write_artifact_part` 只保留 part ID、标题、hash、字符数和写入结果。
- 完整 HTML 只存在于当前 durable tool step payload 和 knowledge storage，不进入最终 conversation message。
- `agent_tool_calls` 对 HTML input 只记录 metadata、hash 和字符数，禁止保存全文。

---

## 7. 用户交互

### 7.1 Plan Card

AI Elements 组件结构：

```text
Plan
├── PlanHeader
│   ├── goal
│   ├── completed / actionable count
│   └── aggregate status
├── PlanTrigger
└── PlanContent (max-height + overflow-y-auto)
    └── Task × N
        ├── status indicator
        ├── title / description
        ├── dependencies
        ├── result link
        └── error / retry state
```

交互规则：

- active 默认展开，completed/abandoned 默认折叠。
- 用户手动折叠后，后续 revision 不强制重新展开。
- 状态必须同时使用图标、文本和无障碍标签，不能只靠颜色。
- 长列表使用滚动区域，不撑高整个消息流。
- 同一 plan 只渲染最新 revision；历史 `update_plan` tool cards 不重复展示。
- plan 与 trace 分离：plan 面向用户，trace 面向排障。

### 7.2 用户编辑

允许用户：

- 新增 pending item；
- 删除尚未开始且无完成结果的 pending item；
- 修改 pending item 标题和描述；
- 重排 pending item；
- 修改依赖关系；
- 显式请求重新执行 completed item。

completed item 和已有 result 默认只读。

编辑提交为类型化 user part：

```ts
type PlanEditData = {
  planId: string;
  baseRevision: number;
  goal: string;
  items: PlanItem[];
  instruction?: string;
};
```

对应 `data-plan-edit` part 通过 `convertDataPart` 转为 `<plan_edit>` 模型内容。主 Agent 必须调用 `update_plan` 接受、规范化或解释冲突，不能直接信任客户端 revision。

### 7.3 运行中转向

用户在 Agent 执行中提交 plan edit 或新指令时：

1. 当前正在运行的 durable tool step 安全结束。
2. 合并最新 tool result 和 plan snapshot。
3. 取消当前 WorkflowAgent run。
4. 已完成 item 保持 completed。
5. 未完成的 in-progress item 恢复为 pending；如果工具已经成功则标 completed。
6. 持久化取消时的 assistant message snapshot。
7. 将 plan edit 作为新 user message 启动下一轮 run。
8. 新 run 自动收到恢复后的 `<active_plan>`。

暂停、停止和放弃的语义不同：

- **暂停**：只断开当前 stream，WorkflowChatTransport 可恢复同一个 run。
- **停止**：取消当前 run，但 plan 仍 active，可以下一轮继续。
- **放弃计划**：将 plan 标记 abandoned，后续不自动继续。

---

## 8. HTML Artifact：作为 Plan 的一种执行

### 8.1 删除 child workflow

删除：

- `artifactGenerationWorkflow`；
- child run `start()` / `getRun()`；
- `workflow_run_id` 绑定；
- generation row progress polling；
- `ARTIFACT_STREAM_NAMESPACE`；
- `data-artifact` 进度快照和双 stream merge；
- tool 内部用于生成 block 的模型调用。

顶层 WorkflowAgent 仍是 durable workflow。每个 artifact tool execute 继续使用 `"use step"`，获得重试、journal 和 observability。

### 8.2 新的 Artifact Tools

#### begin_artifact

```ts
type BeginArtifactInput = {
  planId: string;
  title: string;
  filename: string;
  kind: "html" | "markdown";
  mode: "document" | "presentation" | "dashboard";
  theme?: { preset: string; accent: string };
  parts: Array<{
    planItemId: string;
    type: string;
    title: string;
  }>;
};
```

职责：创建 generation/document reservation、保存 manifest 和 item→part 映射，不生成内容。

#### write_artifact_part

```ts
type WriteArtifactPartInput = {
  generationId: string;
  planItemId: string;
  partId: string;
  type: string;
  title: string;
  content: string;
};
```

职责：

- 校验 part 属于 manifest；
- 校验 semantic HTML、安全标签和 chart option；
- 使用 `generationId + planItemId` 幂等写入；
- 返回 hash、字符数和持久化状态；
- 不调用任何模型。

主 Agent 模型负责生成 `content`。每个 fragment 是独立 todo，避免一次生成完整大型 HTML。

#### publish_artifact

```ts
type PublishArtifactInput = {
  generationId: string;
};
```

职责：

- 读取 manifest 和所有已保存 parts；
- 按计划顺序编译；
- 注入可信 runtime/CSS/chart hydration；
- 对缺失或失败 part 生成可见错误 section；
- 发布 artifact revision；
- 返回 document/result reference。

### 8.3 主 Agent 执行流程

```text
update_plan(create active plan)
  → begin_artifact
  → update_plan(mark first batch in_progress)
  → write_artifact_part × independent items
  → update_plan(mark batch results)
  → repeat unfinished items
  → publish_artifact
  → update_plan(add artifact result + completed)
  → concise final response
```

同一模型 step 可以产生多个互不依赖的 `write_artifact_part` tool calls，由 WorkflowAgent 作为独立 durable steps 执行。每批完成后再统一更新 plan，避免每个状态变化都额外消耗一次模型 step。

---

## 9. Knowledge 服务清理

彻底删除 artifact generation 对 child workflow 的依赖：

- 删除 `workflow_run_id` ORM 字段；
- 新增迁移，删除唯一索引和数据库列；
- 删除 `BindArtifactWorkflowInput`；
- 删除 `/internal/artifact-generations/{id}/workflow`；
- 删除 transport-ts 的 `bindArtifactWorkflow()`；
- 重新生成 knowledge OpenAPI 和 TypeScript schema；
- 保留 reserve、save plan、save part、list parts 和 publish 能力。

不保留 compatibility shim。项目处于 demo phase，直接迁移到主 Agent 原生形态。

---

## 10. 代码改动范围

### Chat backend

- 新增 plan schema、解析、revision 校验与 active-plan context builder。
- 注册 `update_plan` tool，并更新主 Agent instructions。
- 在 `createAgentRunResponse` 中恢复 active plan并配置 data-part conversion/history pruning。
- 在 `WorkflowAgent.prepareStep` 中压缩 artifact write tool history。
- 取消 run 时合并最新 plan tool output，避免客户端 snapshot 落后。
- 将 artifact tool 拆成 begin/write/publish，删除 child workflow 和 side stream。
- 持久化 assistant parts 时过滤大体积 artifact content。

### Chat frontend

- 定义类型化 Chat UIMessage data/tool types。
- 新增通用 `ChatPlanCard`，特殊渲染 `tool-update_plan`。
- 在会话级别选择每个 plan 的最高 revision，避免重复卡片。
- 补齐 AI Elements 风格 `PlanTrigger` / `PlanContent` / `TaskContent`。
- 支持 pending item 编辑和 `data-plan-edit` 提交。
- 支持运行中编辑后的取消、snapshot 保存和新 run 启动。

### Knowledge / contracts

- 删除 workflow binding contract 和字段。
- 保留 artifact generation/part/revision 领域模型。
- 执行 OpenAPI → transport-ts → frontend client 同步。

### Documentation

- 新增 `docs/ADR/0010-main-agent-plan-context.md`。
- 将 ADR 0009 标记为 Superseded，并指向 ADR 0010。
- 更新 chat/agent 和 artifact 相关领域文档。

---

## 11. 分阶段实施

### Phase A — 通用 Plan

- 实现 `PlanSnapshot` 和 `update_plan`。
- 将 plan tool output 持久化进 assistant message。
- 实现最新 revision 选择和通用 Plan Card。

### Phase B — 跨 run 恢复

- 实现 active-plan context builder。
- 接入 `convertToModelMessages` data conversion 和 history pruning。
- 验证 run 结束、取消、刷新与下一轮恢复。

### Phase C — 用户编辑与转向

- 实现 plan edit UI 和 `data-plan-edit`。
- 实现运行中安全取消、snapshot 合并和新 run 继续。
- 区分暂停、停止和 abandoned。

### Phase D — Artifact 主 Agent 化

- 新增 begin/write/publish tools。
- 主模型逐 item 生成 fragment。
- 接入 prepareStep context 压缩。
- 删除 child workflow、polling 和 artifact side stream。

### Phase E — Knowledge 清理

- 删除 binding API/DTO/client。
- 执行数据库迁移和 schema 同步。
- 更新 ADR 和领域文档。

---

## 12. 验收标准

项目处于 demo phase，不新增测试脚手架。执行 scoped lint/build 和人工验收。

必须覆盖：

1. 普通研究、编码和多工具任务能自动创建 plan。
2. plan 在 tool 执行过程中实时更新且不会重复渲染历史 revision。
3. 刷新、断线和暂停后恢复同一 WorkflowAgent run。
4. run 完成或取消后，下一轮仍能读取 active plan。
5. completed item 不会被重复执行。
6. step guardrail 截断后，下一轮从 pending/failed item 继续。
7. 用户可以编辑 pending todo，运行中编辑能安全转入新 run。
8. 无关新目标会 abandoned旧 plan，而不是污染旧 todo。
9. 大型 HTML 由主模型分 part 生成，不启动 child workflow。
10. 已持久化 HTML part 在失败、取消或重启后不丢失。
11. prepareStep 后模型 context 不包含先前完整 HTML fragments。
12. publish 后 plan result 指向最终 artifact，刷新后仍可打开。
13. knowledge 中不存在 artifact workflow binding API 和字段。

验证命令：

- affected backend/frontend scoped lint；
- `just sync`；
- chat、knowledge、chat MFE scoped build；
- 根目录 `just build`；
- 不自动运行 `just fmt`，除非生成或机械修改产生明确格式漂移。
