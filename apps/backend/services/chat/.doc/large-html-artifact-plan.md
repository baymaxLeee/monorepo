# 大型 HTML Artifact 生成 — 重构设计（基于 AI SDK 7）

> **历史文档，已被 [ADR-0015](../../../../docs/ADR/0015-agent-task-executor.md) 取代。**
> 本文档设想的 child workflow 方案从未实现；实际演进路径是先落地手搓
> worker/lease/poll（无 workflow），再在 ADR-0015 里迁移到独立 `executor`
> 服务 + 真正的 Workflow DevKit。引用的文件路径（`src/services/*`）也已不存在，
> 当前实现在 `src/agent/artifacts/*`（chat 侧，仅剩 markdown + 只读校验）和
> `apps/backend/services/executor/src/artifacts/*`（HTML 生成主体）。保留本文档
> 仅作历史参照。
>
> 状态：设计待 review（已确认方向）
> 范围：`apps/backend/services/chat` + `apps/frontend/packages/components`
> 作者：agent review @ 2026-06-28
> 关联：[agent-tool-artifacts.ts](../src/services/agent-tool-artifacts.ts) / [artifact-workflow.ts](../src/services/artifact-workflow.ts) / [agent-artifacts.ts](../src/services/agent-artifacts.ts)

---

## 0. 目标与已确认决策

**产品目标**：通过自然语言产出大型可交互 HTML（10–100 页），替代 PPT/PDF/Word；
支持 CDN 三方库（ECharts 等）、图表/交互；由**一个与主 agent 共享上下文的 tool** 驱动，
不需要子 agent。

**已确认决策（用户拍板）**：
1. **统一为分块工作流**：删除单次 20k 生成路径，所有 HTML 走 `plan → block 并行 → compile`；短文档自然就是 2–3 个 block。
2. **保留独立 `artifactGenerationWorkflow`**：独立 run id、可单独 resume/观测、不占主 agent step 预算。
3. 本轮先交付本设计文档，review 通过后再改代码。

**版本前提（已核实）**：chat 运行时 `ai` 实际解析到 **7.0.2**（`node_modules/ai` symlink 确认），
`@ai-sdk/workflow@1.0.2` 自身依赖 `ai@7.0.2`。npm `latest=7.0.4`（仅 gateway patch）。
按 7.x 设计正确；可顺手 bump 到 7.0.4。

---

## 1. 现状问题（review 结论）

当前 HTML 生成有**两条独立、能力不对等**的路径：

### 路径 A — 单次生成（[`generateHtmlArtifactContent`](../src/services/agent-tool-artifacts.ts#L105)）
- `Output.object({ schema: htmlArtifactSchema })` 一次产出 `{title, style, body, script}`。
- `injectArtifactRuntime`（[agent-artifacts.ts](../src/services/agent-artifacts.ts#L154)）注入 **ECharts CDN + CSP + error boundary** → 图表能跑。
- **致命**：`maxOutputTokens: 20_000`，单次模型调用塞不下 10–100 页；超限触发 JSON 截断 → `parseHtmlArtifactSections` fallback。**无法满足核心目标**。

### 路径 B — 长文工作流（[`artifactGenerationWorkflow`](../src/services/artifact-workflow.ts)）
架构方向正确（plan → 并行 block → compile），但有 3 个致命缺陷：

1. **图表永不渲染**（P0）：block 把图表输出成 `<div data-chart-option='…'>`（[L99](../src/services/artifact-workflow.ts#L99)），但 `compileAndPublishArtifact` 拼出的 HTML **既无 ECharts `<script>`、也无任何读取 `data-chart-option` 的 hydration 代码**。全仓库 `data-chart-option` 仅此 1 个写入点、**0 个消费点** → 所有图表是空 div。
2. **无 CSP/runtime 注入**（P0）：路径 B 的 compile 完全不注入 CSP；前端 [artifact.tsx](../../../../frontend/packages/components/src/AiChat/artifact.tsx#L212) 用 `<iframe sandbox="allow-scripts">`（无 `allow-same-origin`）。路径 A 的 CSP `script-src … cdn.jsdelivr.net` 才能让 CDN 在 sandbox 下加载，路径 B 缺这层。
3. **block 容错为 0**（P1）：`compileAndPublishArtifact` 要求 `blocks.length === plan.blocks.length`，任一 block 失败 → 整篇 100 页报废，违背分块本应带来的容错优势。

### 其他
- **两套 prompt / 两套壳 / 两套 CSP** 维护负担翻倍，且行为不一致。
- **流式预览空窗**：长文路径只发 `generating(空)`→`persisted` 两个快照，用户盯空白等很久。
- **7.x 命名**：基本已对齐（`instructions`/`onStepEnd`/`onToolExecutionEnd` 都在用）。**唯一残留**：[agent-memory.ts:112](../src/services/agent-memory.ts#L112) 用了 deprecated 的 `system:`。

---

## 2. 目标架构

```
主 agent (runChatAgent, 'use workflow', WorkflowAgent)
  └─ tool: create_artifact  (与主 agent 共享 toolsContext: runId/userId/conversationId/providerId)
       └─ start(artifactGenerationWorkflow)  ← 独立 durable workflow，独立 run id
            ① 'use step' planArtifact      → { theme, blocks[] }  (2..100)
            ② persistPlan                  → knowledge 持久化 manifest + 空 block 占位
            ③ 并行 generateBlock (concurrency=4)
                 每个 block: 产语义 HTML fragment + 图表用 data-chart-option(JSON)
                 失败 → 占位 error section（不 throw 整篇）
                 完成 → 推一次 block 级进度快照（namespace=artifact）
            ④ compileAndPublish
                 - 注入统一 runtime: CSP + ECharts CDN(条件) + error boundary
                 - 注入 chart hydration 脚本（读 data-chart-option → echarts.init）
                 - 按 plan 顺序对齐 section；缺失标红占位
                 - publishArtifactRevision → document_id
       tool 返回 { document_id, total_chars, blocks_ok, blocks_failed }
```

**关键认知**：tool 内部 fan-out 成多个 `'use step'` **不是子 agent**，只是同一/独立 workflow 内的并行 step。
官方 workflow 文档已确认：step 调 step 退化为普通函数调用。所以"一个 tool 搞定"的诉求成立。

---

## 3. 详细设计

### 3.1 删除单次路径
- 删除 [`generateHtmlArtifactContent`](../src/services/agent-tool-artifacts.ts#L105)、`htmlArtifactSchema` 单次相关分支、`htmlArtifactPrompt` / `htmlArtifactSectionPrompt` / `parseHtmlArtifactSections` / `composeHtmlArtifact`（仅单次路径用到的部分）。
- `createArtifactTool` 的 `kind==="html"` 分支**始终**走 `artifactGenerationWorkflow`（已是现状），删掉 fallback 到单次的代码。
- `markdown` 路径保持不变（短文本 streamText 即可，无需分块）。

### 3.2 修复图表 hydration（P0，核心）
在 `compileAndPublishArtifact`（[artifact-workflow.ts](../src/services/artifact-workflow.ts#L122)）注入统一 runtime，复用并提取 [agent-artifacts.ts](../src/services/agent-artifacts.ts) 已验证的常量：

- 提取 `ARTIFACT_CSP` / `ECHARTS_CDN_URL` / `ECHARTS_CDN_INTEGRITY` / `ARTIFACT_ERROR_BOUNDARY` 为共享导出（两路 compile 复用，单一事实源）。
- compile 时：
  1. 扫描所有 block 是否出现 `data-chart-option` → 决定是否注入 ECharts `<script>`（条件注入，纯文本文档不加载 CDN）。
  2. 注入 **chart hydration 脚本**（新增）：
     ```js
     // 伪代码：compile 阶段内联，DOMContentLoaded 后执行
     document.querySelectorAll('[data-chart-option]').forEach((el) => {
       if (!window.echarts) { el.textContent = '图表运行时不可用'; return; }
       try {
         const option = JSON.parse(el.getAttribute('data-chart-option'));
         if (!el.style.minHeight) el.style.minHeight = '360px';
         const chart = window.echarts.init(el);
         chart.setOption(option);
         new ResizeObserver(() => chart.resize()).observe(el);
       } catch (e) { el.textContent = '图表渲染失败: ' + e.message; }
     });
     ```
  3. 注入 CSP meta + error boundary（同路径 A）。
- block prompt（[L94-110](../src/services/artifact-workflow.ts#L82)）保持"图表只输出 `data-chart-option`、不写裸 script"——**这是安全优势**：block 永远不产生可执行 JS，hydration 由受信任的 compile 脚本统一完成。
- 强约束 `data-chart-option` 必须是合法转义 JSON；compile 时 `JSON.parse` 校验失败的图表降级为可见文本占位（不破坏整篇）。

### 3.3 block 容错（P1）
- `generateAndPersistBlock` 失败：捕获后写一个 `error` 占位 block（`{title, error}`），**不 throw**。
- `compileAndPublishArtifact` 不再硬校验 `blocks.length === plan.blocks.length`；按 `plan.blocks` 顺序遍历，缺失/错误的渲染成 `<section data-block-error>` 红色占位。
- 返回值含 `blocks_ok` / `blocks_failed`，tool 把它带回给主 agent，agent 可据此决定是否 `update_artifact` 重生失败块。

### 3.4 流式进度（P1，UX）
- `generateAndPersistBlock` 完成后推一次快照：复用 `ARTIFACT_STREAM_NAMESPACE`，data 增加 `{ blocks_total, blocks_done }`。
- 前端 [ChatArtifactCard.tsx](../../../../frontend/apps/chat/src/components/ChatArtifactCard.tsx) `ArtifactStreamData` 扩展可选 `blocks_total/blocks_done`，`StreamingArtifactCard` 显示"已生成 12/40 页"。
- 不阻塞、不改协议骨架，纯增量字段。

### 3.5 7.x 命名对齐（P2，低风险）
- [agent-memory.ts:112](../src/services/agent-memory.ts#L112) `system:` → `instructions:`（唯一残留；`generateText` 7.x 已 deprecate `system`）。
- 其余调用点已对齐，无需动。可选 `npx @ai-sdk/codemod v7` 全量扫一遍兜底。
- 依赖版本统一升级单列 §3.7。

### 3.6 mode 差异化（已有雏形，补全）
`mode: document | presentation | dashboard`（[L7](../src/services/artifact-workflow.ts#L7)）已传入但只影响 compile 的 CSS 宽高。建议：
- `presentation`：每 block = 一页，`break-after: page`，固定比例（16:9）。
- `document`：连续流式版心，分页符软分隔。
- `dashboard`：grid 布局，图表密度高，默认注入 ECharts。
- 这些只是 compile CSS + plan prompt 的差异，不增加路径。

### 3.7 前后端 AI SDK 7.x 依赖统一升级 + 解锁版本范围

**动机**：当前前后端把 ai-sdk 系列大多 **pin 死精确版本**（无 `^`），导致拿不到 7.x 频繁迭代的修复（如本设计依赖的 `@ai-sdk/workflow` 行为修正）。统一升到最新、并放开到 caret 范围，让次版本/修订版本自动跟进。

**现状 vs 最新（已核实 npm）**：

| 包 | 位置 | 当前 | 最新 | 目标范围 |
|---|---|---|---|---|
| `ai` | chat / components / chat-fe | `7.0.2`（pin） | `7.0.4` | `^7.0.4` |
| `@ai-sdk/workflow` | chat / chat-fe | `1.0.2`（pin） | `1.0.4` | `^1.0.4` |
| `@ai-sdk/react` | chat-fe | `4.0.2`（pin） | `4.0.5` | `^4.0.5` |
| `@ai-sdk/openai-compatible` | chat | `3.0.0`（pin） | `3.0.1` | `^3.0.1` |
| `@ai-sdk/provider` | chat | `4.0.0`（pin） | `4.0.0` | `^4.0.0` |
| `@workflow/serde` | chat | `^4.1.0` | `4.1.2` | `^4.1.2` |
| `@workflow/world-postgres` | chat | `^4.2.0` | `4.2.0` | `^4.2.0`（已 caret） |
| `workflow` | chat | `^4.5.0` | `4.5.0` | `^4.5.0`（已 caret） |

**策略**：
- 全部改为 **caret（`^`）**：允许次版本 + 修订版本自动升级，锁定主版本（防 v7→v8 之类破坏性跳跃）。符合用户要求"不锁定、允许 minor/patch 升到最新"。
- `@ai-sdk/provider` 虽与最新同为 `4.0.0`，也改成 `^4.0.0` 统一风格。
- **跨包版本一致性**：`ai` / `@ai-sdk/workflow` / `@ai-sdk/provider(-utils)` 必须同属一个主版本线（7.x family）。`@ai-sdk/workflow@1.0.x` 自身依赖 `ai@7.0.x`，caret 范围天然满足；升级后用 `pnpm why ai` 复核没有多版本并存导致的类型冲突。
- `zod`：后端 chat 是 `^3.25.76`，前端是 `^4.4.3`。**本次不强行统一**（SDK peer 同时接受 `^3.25.76 || ^4.1.8`），避免无关 churn；仅保持各自现状。

**执行方式**：
- 直接编辑各 `package.json` 改为上表 caret 范围 → `pnpm install`（更新 lockfile）。
- 不用 `pnpm up --latest` 盲升，避免带上非 ai-sdk 包的意外升级。
- 升级后跑 `just lint`（前后端 tsc）+ `just dev` 冒烟，重点验证 `WorkflowAgent.stream` / `createModelCallToUIChunkTransform` / `useChat` 流式仍正常。

**风险**：caret 放开后 CI/部署可能拉到比本地新的 patch。demo 阶段可接受；若需可复现构建，依赖 `pnpm-lock.yaml`（已提交）锁定确定版本，caret 只在显式 `pnpm install`/`pnpm up` 时浮动。

---

## 4. 涉及文件清单

| 文件 | 改动 | 优先级 |
|---|---|---|
| [agent-artifacts.ts](../src/services/agent-artifacts.ts) | 提取 CSP/CDN/error-boundary/hydration 为共享导出；删单次 HTML 专用函数 | P0 |
| [artifact-workflow.ts](../src/services/artifact-workflow.ts) | compile 注入 runtime+hydration；block 容错；block 级进度快照 | P0 |
| [agent-tool-artifacts.ts](../src/services/agent-tool-artifacts.ts) | 删单次 HTML 路径；`create_artifact` html 恒走 workflow | P0 |
| [agent-config.ts](../src/services/agent-config.ts) | 调整/删除单次相关常量（`ARTIFACT_*`）；保留分块相关 | P1 |
| [agent-memory.ts](../src/services/agent-memory.ts#L112) | `system:` → `instructions:` | P2 |
| [ChatArtifactCard.tsx](../../../../frontend/apps/chat/src/components/ChatArtifactCard.tsx) | `ArtifactStreamData` 加 `blocks_total/done`；进度显示 | P1 |
| knowledge 服务（artifact 持久化） | 确认 `saveArtifactBlock` 支持 error 占位（content 存 `{error}`） | P1 |
| chat `package.json` | ai-sdk 系列改 caret 并升最新（§3.7） | P2 |
| components `package.json` | `ai` → `^7.0.4`（§3.7） | P2 |
| chat-fe `package.json`（apps/chat） | `ai`/`@ai-sdk/react`/`@ai-sdk/workflow` 改 caret 升最新（§3.7） | P2 |

> 注：knowledge 服务侧（block 表/publish）已存在（`reserveArtifactGeneration`/`saveArtifactBlock`/`publishArtifactRevision`），本次主要在 chat 侧改 compile 逻辑，knowledge 侧只需确认 error 占位可存。

---

## 5. 风险与注意

1. **iframe sandbox 一致性**：前端 `sandbox="allow-scripts"`（无 `allow-same-origin`）→ 内联脚本可跑、CDN 可加载（受 CSP 限制），但**不能访问父页/同源存储**。hydration 脚本必须纯内联、不依赖同源。✅ 当前设计满足。
2. **CDN 可用性**：ECharts 走 jsdelivr + SRI integrity。CDN 挂时 hydration 已有文本兜底。CSP `connect-src 'none'` 阻止图表联网取数——**图表数据必须在 `data-chart-option` 里内联**，prompt 要强调。
3. **workflow 序列化**：所有 step 不能有 Node-only 顶层 import（与现有约束一致）；`artifactGenerationWorkflow` 已是 `'use workflow'` + `'use step'`，保持。
4. **100 页 token 成本**：plan 限 `blocks.max(100)`，单 block `maxOutputTokens: 8000`，concurrency=4。需确认 provider 并发限额；必要时 concurrency 降级可配。
5. **demo 阶段无测试**：按 AGENTS.md，验证靠本地整栈拉起 + 手动产出一份含图表的多页 HTML，肉眼确认图表渲染。
6. **迁移禁改区**：本设计**不涉及** DB migration（block 表已存在）。若 knowledge 侧需加 error 字段才动 migration，另行授权。

---

## 6. 验证（Definition of Done）

- `just lint` scoped 到 chat + frontend components。
- 本地整栈拉起，自然语言产出：
  - 一份 ≥10 页含 ≥2 个 ECharts 图表的 presentation → 图表真实渲染、分页正确。
  - 一份 markdown → 仍走原路径不受影响。
  - 故意让一个 block 失败 → 整篇仍出，失败块红色占位。
- 流式预览显示 block 进度（N/M 页）。
- 补 ADR：`docs/ADR/NNNN-large-html-artifact.md`。

---

## 7. 分阶段实施（review 通过后）

- **Phase 0（前置）**：AI SDK 7.x 系列依赖统一升级 + caret 解锁（§3.7），`pnpm install` 后 `just lint` + `just dev` 冒烟。**先做**，让后续改动直接基于最新 SDK，避免 patch 行为变化导致返工。
- **Phase 1（P0）**：提取共享 runtime/hydration；compile 注入；删单次路径。→ 图表能渲染、长文可用。
- **Phase 2（P1）**：block 容错 + 进度快照 + 前端进度显示。
- **Phase 3（P2）**：7.x 命名残留（`agent-memory.ts` `system:`）+ mode 差异化 CSS。
