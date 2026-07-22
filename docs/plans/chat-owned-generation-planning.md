# Chat 统一规划、Executor 确定性执行重构计划

## 目标

把 HTML Artifact 与 Video Production 的语义理解和初始规划统一归还给拥有完整会话上下文、附件、Memory、Skill 与最强推理模型的 Chat `ToolLoopAgent`。

目标链路：

```text
完整会话上下文
  → Chat ToolLoopAgent 原生 function call（完整、类型化执行计划）
  → Chat/Executor 边界校验
  → Executor durable Workflow
  → 确定性编排 + 按既定规格生成 + 审批/重试/发布
  → tool result 回到同一个 ToolLoopAgent
```

不新增 `plan_html`、`plan_video` 等中间工具，不在 Chat tool 内再调用一次结构化输出模型，也不保留 Executor 侧的语义 planner、repair planner 或兼容旧 payload 的分支。

## 1. Critical review

### 现状

- Chat 主循环位于 `apps/backend/services/chat/src/application/agent/agents/tool-loop.ts`，已经持有投影后的完整 conversation、attachments、memories、skills 和 instructions，并使用支持 reasoning 与原生工具调用的主模型。
- Chat 的 HTML `write_file` 目前主要把 `brief`、`mode`、`page_count` 交给 Executor；Video `create_video_production` 主要把 `prompt`、可选 `segments`、`characters` 以及文本/图片/视频 provider ID 交给 Executor。
- `workflows/html-artifact.ts` 会调用 `planArtifact()`；`generator.ts` 再以 Executor 文本模型生成 outline/manifest，并包含 repair/fallback。
- `workflows/video-generation.ts` 会调用脚本、角色视觉描述与 storyboard planner，再把结果转成现有 production artifacts 和 ShotPlan。
- Executor 的这些 planning 调用拿不到 Chat 的完整语境，而且其文本模型明确关闭 reasoning；同一用户意图因此被 Chat 和 Executor 连续理解两次。

### 仍然成立的设计

- 一个 Chat `ToolLoopAgent` 作为唯一主 agent loop。
- Executor 作为独立服务承载长任务、重试、取消、恢复和副作用隔离。
- HTML 的分块并发生成、编译、发布以及前台 tool progress。
- Video 的 Workflow Hook、成本治理、Storyboard/Take/发布审批、QA 与 FFmpeg 合成。
- 原生 AI SDK `tool-*` UIMessage parts 和单一 Chat stream，不新增第二条进度协议。

### 系统性问题与结论

1. **重复规划拉长关键路径**：Chat 已经理解意图，Executor 又从压缩后的 brief 重新理解一次。
2. **规划质量倒挂**：上下文更少、推理能力更弱的一侧负责产出最关键的任务结构。
3. **失败归属错误**：Executor 用 LLM repair/fallback 掩盖计划缺陷，原始主 agent 无法利用完整上下文修正 tool call。
4. **职责混杂**：durable Workflow 同时承担语义规划和执行，使执行重放受非确定性 planner 影响。
5. **契约过弱**：通用 `POST /tasks` 的 `payload: unknown` 让跨服务输入没有成为 OpenAPI 的真实约束。

结论是直接重构为“Chat 规划、Executor 执行”，删除旧规划路径，不叠加 adapter 或 compatibility shim。

## 2. Official alignment

- AI SDK `ToolLoopAgent` 本身就是多步模型—工具循环；工具以 `inputSchema` 提供模型原生 function-calling 契约，tool result 会回到同一上下文继续推理。完整计划应当是目标工具第一次调用的参数，而不是另开一个 planner loop。[ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)、[Tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- `prepareStep` 适合控制每一步可见模型、工具、消息和 tool choice；它不是在 Executor 内建立第二个语义 agent 的理由。[Loop control](https://ai-sdk.dev/docs/agents/loop-control)
- Workflow DevKit 要求 Workflow function 做确定性编排；实际 API/LLM 工作应位于可重试并持久化结果的 Step。因此本方案不是“Executor 禁止一切模型”，而是只移除理解与规划模型，保留按冻结规格生产内容的 generation Step。[Workflows and Steps](https://useworkflow.dev/docs/foundations/workflows-and-steps)
- WDK 运行实例固定到启动时 deployment；旧的在途实例继续旧实现，新任务进入新契约，无需为 demo 阶段增加双读或迁移 shim。[Workflow versioning](https://useworkflow.dev/docs/foundations/versioning)
- UI 继续使用官方 tool parts 表达 input、preliminary output 和 terminal output；本次不创建与官方能力重复的 `data-*` part。

## 3. Benchmark check

- **Codex**：主 prompt 汇集 instructions、tools、用户输入与持续增长的 history；模型产生 function call，harness 执行并把结果附回同一 loop。上下文整理与工具执行属于 harness，而不是交给一个缺少上下文的下游 planner。[Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
- **Claude Code**：采用 gather context → act → verify 的单一 agentic loop，工具结果持续进入下一轮判断；复杂任务先在完整上下文中探索和规划，再实施与验证。[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)、[Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- **Cursor**：复杂变更先基于代码库上下文形成结构化计划，再切入执行；规划不是下沉到一个只拿 brief 的后台任务。[Cursor planning](https://docs.cursor.com/en/agent/planning)

本项目对应形态是一个 Chat 主 agent + 一个耐久执行 harness。HTML block workers 和 Video media steps 是执行 worker，不是角色扮演式 sub-agent，也不拥有第二套任务理解权。

## 4. 目标接口

### HTML tool input

创建工具按协议复杂度拆分，避免把嵌套 HTML plan 放进 Markdown/HTML `anyOf`：

- `write_markdown` 使用 `{ title, filename, brief }`。
- `write_html` 使用 `{ title, filename, plan }`，删除 `page_count` 以及“给 Executor planner 的 brief”语义。
- `plan` 包含：
  - `mode`: `document | presentation | dashboard`
  - `source_brief`: 保留用户事实、数据、顺序、约束和明确禁令
  - `theme`: `visual_direction`、`accent`、`appearance`
  - `narrative`
  - `blocks[1..100]`: `title`、`brief`、`layout`、`content_scope[]`、`acceptance_criteria[]`

`page-N`、position 和 block type 由 Chat adapter 根据数组顺序确定性生成；模型不生成内部 ID、版本或幂等键。HTML edit 继续读取既有 manifest，Chat 只提交明确的目标 blocks/change brief，Executor 确定性决定 reuse/revise/regenerate。

### Video tool input

`create_video_production` 从 `prompt + optional segments` 双模式收敛成一个完整计划：

- 顶层：`title`、`creative_brief`、`plan`
- `plan`: `target_duration_seconds`、`logline`、`motif`、`style_bible`、`setting_bible`
- `characters[0..3]`: `name`、`appearance`、可选 `reference_document_id`（可为空数组：旁白/无具名角色视频不强制角色）
- `shots[1..12]`:
  - `purpose`、`plot`、`emotion`
  - `character_names`（引用 `characters[].name`，无具名角色时为空数组）
  - `seconds`
  - `action`、`camera`、`environment`
  - `lighting_palette`、`audio_direction`
  - `continuity_contract[]`、`acceptance_criteria[]`

每镜 4–15 秒，镜头时长总和必须等于 `target_duration_seconds`；用户提供明确脚本/分镜时按原顺序无损映射。Shot ID、order、artifact version、authorization、cost、provider、actor 和 idempotency key 全部由服务端注入。

### Executor task contract

保留一个 registry 风格的 `POST /tasks` 路由，但把 OpenAPI request body 改成按 `type` 判别的联合：

- `type: "html-artifact"` → `HtmlArtifactTaskPayload`
- `type: "video-generation"` → `VideoGenerationTaskPayload`

两个 payload 都携带 Chat 生成的完整计划和服务端生成的 planning provenance：Chat provider/model、conversation ID、run ID、tool-call ID。provenance 仅用于 trace/audit，Executor 不依据它重新推断任务。

跨服务类型只通过 `schemas/openapi/executor-server.json` 和生成的 transport client 传播；Chat 不再手工组装 `payload: unknown`。执行计划 schema 使用明确版本，但本轮只实现新版本，不保留旧版本解析分支。

## 5. 实施方案

### 5.1 Chat 成为唯一语义规划者

- 重写 `artifacts.ts` 与 `media.ts` 的 tool description/input schema；HTML 使用独立 `write_html` object-only schema，让主 `ToolLoopAgent` 在第一次 function call 内产出完整计划。
- tool execute 只做授权检查、结构/跨字段校验、服务端字段注入、任务提交和进度输出；不得嵌套调用 `generateText` 进行二次规划。
- 附件与 reference document 在 Chat 按 conversation/org ownership 校验，并把模型可见的角色外观理解固化到 `characters[].appearance`。
- 更新 Plan Mode capability projection，只说明执行阶段要求完整 HTML/Video plan，不向不可调用的 Plan Mode 暴露完整 execution tool schema。
- 保留现有 `ToolOutcome`、async-generator progress、approval 与 UIMessage tool part 行为。

### 5.2 失败返回原 ToolLoopAgent

- 校验直接用 AI SDK 原生 tool-input 契约,不自造 error code:tool `inputSchema`(Zod `discriminatedUnion` + `superRefine`)覆盖结构约束、数组范围、duration 合计、角色引用唯一性等所有可静态表达的规则。模型产出的参数不满足 schema 时,SDK 走原生 control flow,把 invalid-input 作为 tool 错误回灌同一个 `ToolLoopAgent`,由拥有完整上下文的模型重发修正后的 function call——`execute` 根本不会被调用(与本仓库既有约定一致:invalid input retains native control flow,ADR-0042)。
- 无法在 schema 内表达的运行时校验(附件 ownership、reference document 的 MIME/会话归属)在 `execute` 内完成,失败以 `toolFailed` ToolOutcome 返回,同样回灌模型;这类失败也不会创建 task。
- Executor 在 HTTP 边界用同一套 discriminated schema(`zValidator`)重新校验,作为跨服务信任边界;非法输入在创建 task row 和启动 Workflow 之前即被 400 拒绝。
- Executor 不调用 LLM repair、不猜默认语义、不接受部分计划后补全;未知角色、duration 不一致或越权引用都不得启动 Workflow。

### 5.3 HTML Executor 收敛为执行器

- 新建任务直接把 Chat plan 物化并持久化为 manifest，然后执行 reserve、扁平有界并发 block generation、compile 与 publish。
- 删除 `src/application/artifacts/generator.ts` 中的 outline/规划链：`planArtifact`、`generateOutline`、`materializeOutline`、`deterministicOutline`（semantic fallback）与 `repairInstructions`（page_count 不匹配时的二次生成）；同时移除 `workflows/html-artifact.ts` `planStep` 里对 `planArtifact` 的调用。
- 保留 per-block generation LLM（`generator.ts` 的 `generateBlock` 与 `buildArtifactTextModel`）：它只接收冻结的 document contract 与 block spec，输出该块 HTML，不得改变 block 数量、顺序、叙事职责或验收标准。
- revision 路径继续读取现有 manifest，根据明确 change target 确定性计算 reuse/revise/regenerate；不调用规划模型。
- 现有 HTML validator 与 Chat correctness gate 保持不变，避免把“规划归属迁移”扩大成校验架构重写。

### 5.4 Video Executor 收敛为执行器

- Workflow 直接把 Chat plan 确定性物化为现有 `CreativeBrief`、`Script`、`ShotPlan` 和 `AssetManifest` artifacts。
- 删除理解/规划链：`src/application/video/script.ts` 的 `planScript`、`storyboard.ts` 的 `planSegments`、`characters.ts` 的 `describeCharacterAppearances`（Executor 侧角色视觉描述），以及 `script.ts` `buildScriptFromSegments` 内嵌的 anchors 规划（`generateOutline`-style LLM 调用、`anchorsInstructions`、`deterministicAnchors`）；`video-generation.ts` `planStep` 相应收敛为对 Chat plan 的确定性物化。从 `videoGenerationInputSchema` 删除 `textProviderId`（provider 由服务端注入）。
- `video-production/service.ts` 继续负责服务端 ID/order/version、production projection、审批和持久化，不再从 prose 反推 shots。
- 角色参考图生成保留为独立 generation Step（`storyboard.ts` 的 `generateCharacterSheet`）：只依据已冻结的角色 appearance/reference 生产 identity anchor，不得改写剧情、镜头或 continuity contract。
- 保留成本 reserve/reconcile、Storyboard 审批与版本修订、付费 Take、Take review、FFmpeg、QA、发布审批、取消补偿和 Workflow Hook。

### 5.5 Contract、文档与可观测性

- 在 Executor 定义 discriminated task payload：`src/api/http/routes/tasks.ts` 的 create-task Zod schema、`src/application/tasks/registry.ts` 的 per-type `inputSchema`、以及 `src/gen-openapi.ts`（当前把 `payload` 输出为无类型 description）都要改成按 `type` 判别；随后重新生成 `schemas/openapi/executor-server.json` 与 `apps/backend/libs/transport-ts` client。运行时校验（registry `inputSchema.safeParse`）已存在，本轮是把它提升为 OpenAPI/transport 层的真实契约，并消除 Chat 侧 `infrastructure/clients/executor.ts` 与 `libs/transport-ts` 的 `payload: unknown`。
- trace 中区分 `planning` 与 `generation` span，并记录 plan schema version、Chat model、tool-call ID、task ID；不记录未脱敏的完整会话。
- 更新 ADR-0015、ADR-0018、ADR-0046、ADR-0047，以及 Chat/Executor domain docs 和已失效的 `AGENTS.md` 描述。
- 新增 `docs/ADR/0049-chat-owned-generation-planning.md`，记录唯一规划者、允许的 Executor 模型边界、失败回主 loop 以及直接替换旧契约的决策。

## 6. 实施顺序

- [x] 定义 HTML/Video plan schema 与跨字段校验。
- [x] 将 Executor `POST /tasks` 改为 discriminated union，运行 OpenAPI/transport codegen。
- [x] 改造 Chat `write_html`，用原生 object-only tool input 一次产出完整 HTML plan。
- [x] 改造 HTML Workflow 直接消费 manifest，删除 Executor outline planning/repair/fallback。
- [x] 改造 Chat `create_video_production`，用原生 tool input 一次产出完整 Video plan。
- [x] 改造 Video Workflow 直接物化 production artifacts，删除文本/视觉 planning 调用和 `textProviderId`。
- [x] 校准 generation-only Step，确保它们不能改变冻结计划的结构与语义职责。
- [x] 更新 tracing、ADR、Chat/Executor 文档及 agent-facing 约定。
- [x] 执行 scoped lint/build、`just sync`、根构建与 implementation review。

HTML 与 Video 分两次可独立审阅的实现批次，但新旧 task contract 不在运行时并存；每个批次都先完成对应 Chat producer 与 Executor consumer，再删除该类型的旧路径。

## 7. 验收标准

### 行为

- 新建 10 页 HTML 时，Chat tool call 在任务启动前已经包含全部 blocks、叙事、主题与验收标准；Executor trace 中没有 outline/planning 模型调用。
- HTML blocks 仍按 provider 限流内的现有并发策略生成、编译并发布；一次 planning LLM 往返从关键路径消失。
- HTML 定向编辑只处理命中 blocks，未命中 blocks 原样复用；Executor 不重新理解全局编辑意图。
- 自动视频和用户显式分镜视频都在 Chat tool call 中形成最终 shots；Executor 初始 projection 直接包含该计划并进入 storyboard approval。
- 带人物参考图的视频由 Chat 固化可见外观描述；Executor 只生成或绑定 identity anchor，不运行视觉理解 planner。
- Stop/Abort、HTML progress、视频三段审批、重拍、发布、Workflow 重启恢复均不回归。

### 错误与安全

- 非法 blocks/shots 数量、duration 合计、未知角色由 Zod schema/`superRefine` 拦截,带 field path 的原生 invalid-input 结果回灌模型;越权 document ID 和错误附件类型由 `execute` 内校验以 `toolFailed` 返回。
- 无效输入不创建 task row、不启动 Workflow、不预留费用。
- 同一个 ToolLoopAgent 能读取错误并产生修正后的新 tool call；Executor 没有语义 repair/fallback。
- provider、actor、cost、内部 ID 和幂等字段无法由模型输入覆盖。

### 调用数与性能

- HTML 每任务减少 1 次 Executor planning LLM 调用。
- 自动视频减少脚本与 storyboard 两类 Executor 文本 planning 调用；有角色参考时再移除 Executor 视觉理解调用。
- Executor 中允许出现的模型调用只剩 HTML block 渲染、角色参考图和实际媒体生成等 generation-only Step。
- 比较迁移前后现有 model/workflow traces 的 task accepted → first generation step 与 task accepted → terminal 时延，不新增无产品依据的性能阈值。

### 检查命令

Demo 阶段不新增 test file、fixture、mock 或测试配置，也不运行 `just test`；`just fmt` 只在生成或机械修改确有格式漂移时运行。

`just lint <target>` / `just build <target>` 的 scoped 形式只在 `apps/backend` 下有效；根目录没有 `just lint chat` 这类 recipe，且根目录 `just build chat` 会命中前端 `apps/frontend/apps/chat` 而非后端 chat 服务。因此后端服务的 scoped 校验必须在 `apps/backend` 内执行，根目录只跑跨栈 `just sync` 与全量校验。

```bash
# 后端 scoped 校验（必须在 apps/backend 内）
cd apps/backend
just gen-openapi executor   # 重新生成 executor OpenAPI（discriminated task payload）
just lint chat
just lint executor
just build chat
just build executor

# 跨栈契约与全量校验（回到根目录）
cd ../..
just sync                   # backend OpenAPI → apps/backend/libs/transport-ts + 前端 client
just lint
just build
```

完成后按 `docs/ADR/0016-post-implementation-review.md` 做多服务 implementation review，并确认没有非预期 generated diff。

## 已锁定决策

- 只移除 Executor 的规划/理解 LLM，不禁止按完整规格执行的 generation model Step。
- 计划校验失败直接回到原 Chat `ToolLoopAgent`；Executor 不做自动语义修复。
- Markdown、HTML 质量门、Video director workspace 与前端 tool-card 输出协议保持不变。
- 本次直接替换旧契约，不提供 demo 阶段 compatibility shim。
- 单一主 agent 优先；本方案不引入 planner sub-agent、角色 persona 或第二个 agent loop。
