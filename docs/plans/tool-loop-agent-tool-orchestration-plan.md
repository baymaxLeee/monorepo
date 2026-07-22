# ToolLoopAgent 工具编排重构计划

## 目标

保持单一 `ToolLoopAgent`，不引入 `WorkflowAgent`、手写 agent loop 或声明式 DAG，形成以下薄编排链路：

```text
LLM tool calls
  → batch compatibility policy
  → AI SDK 原生并行执行
  → completed batch 归一化
  → 纯函数 history fold
  → next-step directive batch
  → prepareStep
```

普通工具继续由模型自主选择；harness 只强制真实数据依赖、安全边界和必须完成的 correctness gate。

## 背景与约束

### Benchmark 结论

- Codex 采用模型主导的循环，harness 负责工具执行、结果回灌、权限和 sandbox，不预编排普通工具链：[Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)。
- Claude Code 用 `PreToolUse`、`PostToolBatch`、`Stop` 等 hook 强制确定性边界；`PostToolBatch` 位于整批工具完成与下一次模型调用之间：[Claude Code hooks](https://code.claude.com/docs/en/hooks)。
- pi-agent 默认并行执行 tool batch，通过 `afterToolCall` 处理单结果、`prepareNextTurn` 处理完整批次，并支持明确的 sequential exception：[pi agent loop](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)。
- AI SDK 7 没有独立 batch hook；正式控制面是 `prepareStep + runtimeContext + activeTools + toolChoice + model override`：[AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control)。

### 已锁定约束

- 只重构当前 Chat runtime，不建设通用编排平台。
- 不引入 `WorkflowAgent`、自定义主 agent loop、DAG、运行时锁或通用 prerequisite scheduler。
- 普通工具顺序由模型决定，harness 只强制 correctness gates。
- HTML 校验保持独立、可见且属于 Chat，不进入 Executor Workflow。
- 参数已经完整确定的 correctness action 由 harness 精确发出；需要语义判断的动作仍交给主 LLM。
- LLM reviewer 只产生 advisory，永不参与自动修复的阻塞收敛。
- 不增加新的可配置重试阈值；使用无进展检测和 AI SDK 既有 20-step 总预算收敛。
- exact directive 虽然不请求 provider、token usage 为零，但仍是真实 AI SDK step，统一计入 20-step 硬上限。
- 20-step 是整个 run 的安全上限，不对 gate 另设隐形预算；必须保留最后一次无工具说明的机会。
- 继续使用官方 UIMessage `tool-*` parts 和主 SSE，不增加 `data-*` 或第二条进度流。

## 实施方案

### 1. 集中式 batch compatibility policy

- 将现有 `plan-tool-ordering` 直接重构为封闭的 `tool-batch-policy`，继续作为 model middleware，在 AI SDK 执行工具前过滤冲突调用。
- middleware 无条件 wrap provider model，不再仅在 `mode === "plan"` 时挂载；plan exclusivity 只在命中相关 tool name 时生效，`load_skill` barrier 则覆盖 normal/plan 全模式。
- 仅编码两类真实 correctness dependency：
  - `ask_user` 与 `write_plan/update_plan` 互斥，模型首先输出的组获胜。
  - `load_skill` 是 barrier：若它先出现，只保留它；若普通工具先出现，丢弃本批后出现的 `load_skill`，允许模型下一 step 重试。
- 保留其他工具调用以及 AI SDK 原生的 same-step 并行执行。
- `update_todos → deliverables` 继续是 prompt barrier；它只影响 UI 顺序，不升级为硬门禁。
- 不向 tool manifest 添加通用依赖、并发组或调度配置。
- 分工写死：middleware 只处理“当前 model step 已产生的冲突 batch”，避免不兼容工具落地；`prepareStep.activeTools/toolChoice` 只塑造“下一 step 可以做什么”，包括 Skill 成功加载后移除 `load_skill` 和 correctness gate 限定。两者不互相代替，不重复归约历史结果。

### 2. 纯函数 completed-history fold

- 在 `AgentRuntimeContext` 内增加统一 `orchestration` 快照：
  - `skillLoadedThisRun`
  - execution-plan read coverage/failure
  - artifact verification state
- 从 `tool-loop.ts` 外提 `deriveOrchestrationState(seed, steps)` 纯函数。每次 `prepareStep` 从 immutable run seed 对全量 `steps` 重放；20-step 上限下这个成本可忽略，不引入 `reducedThroughStep` 或任何可变水位。
- 返回的 `runtimeContext.orchestration` 是当前 `steps` 的派生快照，不作为下次 fold 的累加起点。因此相同 `(runtimeContext seed, steps)` 重复调用必须得到完全相同的 directive。
- 将 completed history 归一化为按 `stepNumber` 和原始 tool-call 顺序排列的 terminal events：
  - 接受最终 `tool-result` 和 `tool-error`。
  - 忽略 preliminary/running results。
  - fold 内用局部 `Set` 按 `toolCallId` 去重，同 id 只归约一次。
  - 并行完成顺序不得影响 reducer 结果。
- `onToolExecutionEnd/onStepEnd` 继续只用于 telemetry，不通过共享闭包修改 orchestration state。
- `prepareStep` 只负责调用纯 fold，再把 directive 投影为 AI SDK 的 `model/activeTools/toolChoice/instructions/runtimeContext`。

Directive 优先级固定为：

1. step budget 的最终失败说明。
2. 显式 Plan 尚未完整读取或读取失败。
3. HTML validate/repair correctness gate。
4. 已加载 Skill 后移除 `load_skill`。
5. 默认开放工具，由模型自主选择。

### 3. 精确 correctness directives

- 将现有零-token forced model 封装成窄范围的 `exactToolDirectiveModel`，`doStream` 和 `doGenerate` 都由 harness 注入同一批精确 tool calls。删除当前 `doGenerate` 直通 base model 的错误实现。
- exact directive 发出原生 AI SDK tool calls，使用完整确定的 tool name/input、唯一 call id 和零 token usage，不请求 provider 模型重新生成参数。
- 仅允许以下内部 gate 使用：
  - `validate_html(file_id)`。
  - 根据 deterministic findings 完整构造的 `edit_file(document_id, changes)`。
- 同一 gate 阶段中，多个互不依赖的 artifact 合成一个 directive batch：同一 step 并行 validate，有错时下一 step 并行 repair，再下一 step 并行 revalidate。同一 artifact 的 validate → repair → revalidate 仍严格串行。
- 每个 exact batch 只包含同一 tool name，同时设置对应的 `activeTools` 和 `toolChoice`，使 trace 中的 effective step policy 清晰可见。
- exact directive 完成后删除 artifact gate 专用 `repairToolCall` 补丁、`artifactGateDirective` 可变闭包，以及 `onStepEnd` 中“未产出 expected gate tool 就 throw”的补偿逻辑。exact model 确定性注入后，这些均为重复控制面。
- 不把 exact directive 开放为 tool author 可配置的通用“下一工具”协议。

### 4. HTML validation 收敛

- `validate_html` 继续作为 Chat-local、独立可见的工具；Executor HTML Workflow 只负责生成、编译和发布。
- 只有 deterministic validator 的 `errors` 能进入 repair；`advisories` 继续展示给主模型，但 reducer 完全忽略它们。
- 为 deterministic errors 生成稳定 fingerprint，只取排序后的 `block_id + code` 和 validator 明确定义为稳定的结构化规则参数。fingerprint 严禁包含 LLM reviewer 文案、`reason/suggestion`、行列位置或 evidence，避免文案漂移破坏 A→B→A 振荡检测。
- 每个 artifact verification item 记录已见 fingerprints：
  - 新 fingerprint：进入 repair。
  - repair 后再次出现任一已见 fingerprint，包括 A→B→A 振荡：标记 `no_progress`，停止自动修复。
  - validator/tool failure：标记 failed，不做不可见重试。
  - 无 hard errors：完成当前 artifact。
- 恢复 AI SDK 20-step 硬上限，且从 step 1 开始为 Plan 读取、Skill、主模型工具 batch 和 exact gate 统一计数。当只剩一次 model call 时，禁用工具并输出终态说明；不允许先强制一个新 gate 再依赖第 21 步总结。

#### 20-step 预算证明

- execution Plan 最大 40,000 字符，`read_file` 每次最多 8,000，因此完整读取最坏为 5 steps。
- 设 `S` 为除 Plan 读取、HTML gate 和最终说明外的主工作 steps，`R` 为任意 artifact 经历的最多有进展 repair 轮数。独立 artifact 合批后，gate 成本与 artifact 数量无关，上界为 `1 + 2R`（首次 validate，每轮 repair + revalidate）。整个 run 上界是 `5 + S + (1 + 2R) + 1`。
- 现实重任务取 `S = 4`（load_skill、update_todos、一批主产物、一批补充工具）、`R = 2`，共 `5 + 4 + 5 + 1 = 15 steps`，剩余 5 steps 容纳模型拆批或一次额外工具往返。
- 20 不是“任意任务都保证完成”的证明，而是安全上限。若主工作已消耗预留空间，已生成产物必须保留，将 verification 终态标记为 `incomplete_budget`，且最终响应明确说明“产物存在但校验未完成”。这是本方案对撞上限的产品语义，不另设 gate 计数器也不绕过 SDK step 预算。

### 5. 原生 tool-part 实时状态

- 将 `validate_html` 实现为 async-generator tool，通过 preliminary ToolOutcome 依次上报：
  - `deterministic_validation`
  - `content_review`
  - terminal `completed/failed`
- 为 tool metadata 增加 `uiKind: "validation"`，Chat MFE 增加专用校验卡片，显示：
  - 确定性检查中。
  - 内容复核中。
  - 校验通过。
  - 需要修复。
  - 校验失败或无进展。
  - advisory 数量。
- 最终输出继续使用 `{ valid, file_id, errors, advisories }`，不改变现有 artifact output 或 OpenAPI。
- progress 与 terminal state 全部通过主 UIMessage stream 的同一个 `tool-validate_html` part 传递。

### 6. 文档收口

- 更新 ADR-0035，记录集中 batch policy、纯函数 post-batch history fold 以及 prompt/hard-gate 边界。
- 更新 ADR-0048，记录 exact directives、deterministic-only blocking、no-progress fingerprint 和 20-step 收敛。
- 更新 Chat `AGENTS.md` 与 agent README，明确 `prepareStep` 是项目内的 `PostToolBatch/prepareNextTurn` 适配层。
- 合并并保留当前工作树已有的 plan-mode terminal behavior 修改，不覆盖用户未提交内容。

## 任务

- [ ] 将 `plan-tool-ordering` 重构为集中式 `tool-batch-policy`，迁移 plan exclusivity 并加入 `load_skill` barrier。
- [ ] 为 `AgentRuntimeContext` 增加统一 orchestration state，并实现 terminal tool-batch normalization。
- [ ] 将 execution-plan、Skill 和 artifact verification 收敛为无副作用的 `deriveOrchestrationState(seed, steps)` 纯函数 fold，不引入 `reducedThroughStep` 或任何可变水位。
- [ ] 实现统一 directive resolver 及固定优先级，并把 `tool-loop.ts` 收敛为薄 `prepareStep` adapter。
- [ ] 封装 streaming/non-streaming `exactToolDirectiveModel`，迁移 validate/repair，删除 gate 专用 `repairToolCall` patch、`artifactGateDirective` 可变闭包，以及 `onStepEnd` 未产出 gate tool 的 throw 补偿。
- [ ] 为 deterministic validation findings 增加稳定 fingerprint、振荡检测和 `no_progress` terminal state。
- [ ] 恢复 20-step 硬上限，并在预算耗尽前保留最终失败说明 step。
- [ ] 将 `validate_html` 改为分阶段 preliminary ToolOutcome async generator。
- [ ] 增加 validation tool UI kind 和前端校验状态卡片，不新增自定义 stream part。
- [ ] 更新 ADR-0035、ADR-0048、Chat AGENTS 和 agent README。
- [ ] 执行 scoped lint/build、`just sync` 和根目录 lint，确认无非预期生成差异。

## 验收标准

### 编排行为

- 普通独立 deliverables 仍在同一 step 并行执行。
- `load_skill` 与下游工具同批时只执行兼容的一侧，下一 step 能正确继续。
- `ask_user` 与 plan write 冲突时只保留首先输出的组。
- `update_todos` 仍是 prompt-level UI barrier，不成为 runtime lock。
- 多页 Plan 的 `read_file` coverage 由纯函数 fold 对全量 `steps` 重放派生；相同 `(seed, steps)` 重复调用产出完全一致的 directive。
- `runtimeContext` 是唯一 run-state 来源，没有由 tool callbacks 或模块级可变闭包修改的共享状态。

### HTML gate

- 多个 HTML 在同一批生成后，按原始 tool-call 顺序逐个校验。
- deterministic error 触发 exact repair 和 revalidation。
- advisory-only 结果直接完成 gate，不触发自动修改。
- 相同或振荡 fingerprint 触发 `no_progress`，agent 如实说明未通过校验。
- validator、repair failure 或预算耗尽不会形成无限循环。
- exact directive 的 tool name/input 与 reducer 生成值完全一致，不经过 provider LLM 改写。

### 流式 UX 与兼容性

- 前端在同一个 `tool-validate_html` part 上实时显示 deterministic validation、content review 和 terminal 状态。
- Stop/Abort 继续传播到 validator 和 LLM reviewer。
- client-tool continuation、Redis UIMessage replay 和 artifact task progress 保持原行为。
- 不新增 WorkflowAgent、第二条 SSE、`data-*` part、OpenAPI 字段或持久化状态机。

### 检查命令

Demo 阶段不新增测试文件、fixture 或测试配置，也不运行 `just fmt`。

```bash
cd apps/backend
just lint chat
just build chat

cd ../frontend
pnpm -F chat lint
pnpm -F chat typecheck
pnpm -F chat build

cd ../..
just sync
just lint
```
