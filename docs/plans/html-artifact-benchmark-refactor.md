# 对齐 Codex、Claude Code、Cursor 的大型 HTML Artifact 重构

## 1. Critical review

- 当前 `manifest + blocks + compiled revision` 方向正确，但实现仍把 generation
  job、block version、revision snapshot 混在一起：`artifact_block_versions` 名为
  version 实为“每 generation 一行”，`documents` 没有 `current_revision_id` 指针
  （读“最新”靠 `ORDER BY created_at DESC`，本身有竞态）。
- 4 路 block step 是真实并发；但并发度硬编码 `BLOCK_CONCURRENCY = 4`（无依据、
  大文档 25 波延迟悬崖）、`completed_blocks` 每次 `save_block` 重算 COUNT（并发
  写有窗口）、发布是 check-then-act 非行锁、同文档工具并发和**静默编辑失败**
  （revise 失败静默保留原块并报成功）使其不可靠。
- `block_ids + 全局 brief` 不能称为精准编辑：它只是把全局 brief 缩到块级，**仍是
  整块重生**，改一处会让整块措辞/配色/布局漂移、无可复核 diff；chat 侧也没有枚举
  块的读工具，模型没点选时只能猜 `page-N`。
- **两处自相矛盾需先纠正**：
  1. 早期方案引入 `depends_on` + DAG 分波，直接违反 ADR-0022 决策 #3（并行分组是
     prompt 级引导，*故意不写解析代码、不加机器*）与三家 benchmark（并发只跑相互
     独立的工作、不建内容 DAG）。
  2. Benchmark 引的是 Claude Code `Edit` 的锚定 old→new 补丁、Codex 按 hunk 接受/
     回退，方案却落成整块重生——引对了标杆、实现了更弱的机制。
- 校验器 `validateArtifactHtml`/`inspectArtifactHtml` 在 chat 与 executor 各有一份，
  会像 ADR-0015 的 SSRF client 那样漂移。
- 结论：保留高层架构，直接重构存储快照、编辑契约、并发与失败控制，不加兼容层；
  砍掉 DAG，改用契约让块独立；把“精准”落成锚定文本补丁。

## 2. Official alignment

- 继续使用一个 `ToolLoopAgent`；HTML 作为前台阻塞的 durable tool，async generator
  只传进度和最终引用（ADR-0015 不变）。
- **并发用 Workflow DevKit 原生能力，不自造调度器**：fan-out 保持**扁平、块相互
  独立**（`Promise.all` / 有界 worker pool）；可靠性押在 **WDK step 重试**上——块
  step 以 `generation_id+block_id` 幂等，重放/重部署按已完成版本跳过。并发度由
  **provider 限流/并发配置派生**（admin 拥有 provider 配置），不再是魔数，429 交给
  step 重试而非自造节流。
- **精准编辑照搬 Claude Code `Edit`**：编辑对象是**每块存储的 HTML 源**（非编译产物，
  照搬 Codex “编辑源、不编辑部署产物”）；块内 string-anchor `old_string`→`new_string`，
  read-before-edit + 唯一性匹配。它是 **best-effort 优化：锚定 miss 自动降级为“只重生
  该块、其余块按引用复用”**，不打断用户；只有跨版本并发冲突才报 typed conflict。整块 /
  全文重生是保底与“重设计”档。
- Knowledge 保存 editable source graph；完整 HTML 只作为确定性编译产物，不进入
  聊天上下文。交叉引用（目录、跨节引用）由编译期确定性解析，不在生成期串行喂产物。
- 使用 AI SDK `data-*` 传递官方协议未覆盖的预览选块引用（`data-artifact-edit-target`），
  完全复刻现有 `data-plan-execution` 先例（挂到用户消息、持久化、投影进模型上下文），
  并登记到 `schemas/streaming/chat-uimessage-stream.md`。

## 3. Benchmark check

- **Codex**：Sites 保存源项目版本后再部署；Browser 支持点选区域、精确评论、DOM/样式
  检查；Review 支持**按 hunk 接受或回退**。照搬“稳定源文件/版本 -> 构建产物 -> 预览
  验证”，不直接编辑部署产物；编辑以最小可复核 hunk 为单位。[Sites](https://developers.openai.com/codex/sites)、[Browser](https://developers.openai.com/codex/app/browser)、[Review](https://developers.openai.com/codex/app/review)
- **Claude Code**：`Edit` 使用**明确的旧值/新值**精确定位、read-before-edit、唯一性
  匹配、失败响亮报错；修改前创建 checkpoint；Desktop 每次编辑后自动截图、检查 DOM、
  点击页面并修复。照搬“带前置版本的锚定 patch + checkpoint + render verification”。[Edit contract](https://code.claude.com/docs/en/hooks)、[Checkpointing](https://code.claude.com/docs/en/agent-sdk/file-checkpointing)、[Desktop preview](https://code.claude.com/docs/en/desktop)
- **Cursor**：Design Mode 点选**元素**时同时携带 XPath、组件、属性、computed styles 和
  截图；视觉上下文辅助定位，身份仍来自结构化 DOM。照搬其“点选元素 + 结构化锚点”，
  用锚定补丁桥接元素级，v1 不建任意 DOM 节点编辑器。[Design Mode](https://cursor.com/blog/design-mode)
- 三家都只**并发独立工作**；重叠写入通过串行、checkpoint 或隔离工作区处理，**没有
  谁为文档生成建内容块 DAG**。[Codex subagents](https://developers.openai.com/codex/concepts/subagents)、[Claude parallel agents](https://code.claude.com/docs/en/agents)

## 4. Single-agent check

- 主 Agent 负责理解用户意图并调用一次 `edit_file`；用户未点选时，靠 workspace 读
  工具枚举块把意图映射到 `block_id`，不再猜 `page-N`。
- block fan-out 是确定性 workflow worker（扁平、相互独立），不创建 writer/designer 等
  persona agent；per-block 重试是 WDK step 原生能力，不是编排器。
- 同一 document 的多个 generation 串行；块在一个 generation 内扁平并发；不同 documents
  可并发生成或编辑。

## 5. Refactor decision

### Source graph

拆分为 immutable `artifact_block_versions`（真·版本，一次锚定编辑=从父版本精确字节
派生一个新版本）、执行态 `artifact_generation_blocks`、快照映射 `artifact_revision_blocks`。
Revision 像 Git tree 一样记录每个 block 指向哪个 version；未修改 block 只继承引用，
不再复制和重写。`documents` 新增 `current_revision_id` 指针，读路径改用它（不再
`ORDER BY created_at`）。重放/重部署时已完成 block version 按 `generation_id+block_id`
幂等跳过，不重跑已生成块。

### Manifest / document contract（不引入 depends_on）

增加稳定 `document_contract`，包含事实、术语、设计 tokens、导航目标；所有 worker 使用
同一 contract。**contract 就是让块相互独立的机制**——块无需依赖别块的生成产物即可
生成，因此**不加 `depends_on`、不做 DAG 分波**。唯一真实的块间关系是交叉引用（目录、
跨节引用）：由 `compileAndPublishStep` 在编译期用已知的全部块 id/title/position **确定性
解析**；确需“摘要型”内容时，做成 contract 冻结后**最后生成的单块**，而非通用调度器。

### Concurrency & retry

- 并发度由 provider 限流/并发配置派生（替换硬编码 `4`），受 Workflow World worker
  并发上界约束。
- 每块生成走 **WDK step 重试**（幂等键 `generation_id+block_id`）；重试耗尽才影响
  generation 结果。provider 429/瞬断由重试吸收，不自造节流。
- 大文档（数十~百块）以有界并发扫完；块过大易截断、过小损连贯，planner 按自然文档
  结构切块并把块数/尺寸写入 contract。

### Atomic publish

发布是单事务：①`SELECT ... FOR UPDATE` 锁 document 行；②事务内**重查 block version
真值**（而非读回 `completed_blocks` 计数）；③校验 `base_revision_id` 未变；④写
`artifact_revisions` + `artifact_revision_blocks` 映射；⑤翻转 `documents.current_revision_id`
指针。进度计数只作缓存与 UX，不再作为发布真相。

### Edit contract（锚定为主、块重生保底的自动降级阶梯）

前提：**编辑的是每块存储的 HTML 源片段，不是巨大的编译产物**。所以“精准到某一行”不是
对编译后大文件按行号定位（脆弱、benchmark 都不用行号），而是对块源做 **string-anchor**
定位（Claude Code `Edit` 语义）。

三档，形成自动降级阶梯：

```ts
// 1) 锚定精修(默认,best-effort):块源上最小 diff、可复核、确定性,照搬 Claude Code Edit
{ document_id, base_revision_id, scope: "anchor",
  changes: [{ block_id, base_version_id,
              edits: [{ old_string, new_string }] }] }

// 2) 块级重生(保底,永远可用):只重生该块、其余块按引用直接复用
{ document_id, base_revision_id, scope: "blocks",
  changes: [{ block_id, base_version_id, brief }] }

// 3) 全文重写
{ document_id, base_revision_id, scope: "all", brief }
```

- **保底永远是 #2**：改哪个块就只重生哪个块，其余块在 Git-tree 快照里**按引用复用、
  字节不变**。这是确定性地板，任何情况都成立。
- **#1 是 #2 之上的 best-effort 优化并自动降级**：锚定 `old_string` 未找到 / 不唯一 /
  `base_version_id` 过期 → **不报错阻塞用户，直接回退到 #2 重生该块**。“做不到就降级为
  只精准改一个块、其他复用”即内建兜底。
- **可靠性前提**：块源以 **pretty-print/规范化**存储（消除 Claude Code 头号失败——空白
  不匹配），配合 read-before-edit 与足够上下文保证唯一。
- **point-select 提供锚点候选**：用户点选元素时 runtime 上报该元素 `outer_html`/文本作
  提示，模型结合读回的块源定位 `old_string`（点选来自编译 DOM，需与源对齐；图表等被
  编译转换的节点对不上时走降级）。
- 每条 change 带读到时的 `base_version_id`（read-before-edit 闭环）。typed conflict 仅
  用于**跨版本并发冲突**（`base_revision_id` 变化、别的 generation 抢先）与未知/重复/空
  block selection；锚定 miss 走降级、不算 conflict。

### Failure semantics（CREATE 与 EDIT 分开）

- **EDIT**：目标 block 失败则整个 edit generation 失败，旧 revision 保持 published；
  **禁止静默复用旧内容后返回成功**（修掉现状 revise 静默回退）。
- **CREATE**：优雅降级——失败块渲染为可见 error section、回报 `blocks_failed` 让 agent
  可重编辑，不因单块失败丢弃整篇；`required` 窄口径，仅 required 全 ready 才算成功，
  非 required 可降级。

### Workspace API + agent 读工具

新增 artifact workspace 查询，返回 `revision_id` 和
`blocks[{id,title,type,position,status,content_hash}]`，并**可按需返回块当前 HTML**
（artifacts 版 read-before-edit 基元，锚定编辑依赖它）。落成一个 chat 侧 `read` 工具供
agent 枚举/读取块；`html_validate` 复用同一 inventory（返回完整清单而非仅计数）。合并
chat/executor 两份校验器为一处。

### Point-to-edit UI

compiler 保留 `data-block-id`；可信 runtime（仅我方编译器注入，带
`data-chat-artifact-runtime` 标记）通过 `postMessage` 上报选中 block。预览 iframe 是
`sandbox="allow-scripts"` 无 `allow-same-origin`（origin 为 opaque），故父页面**只校验
`event.source === iframeEl.contentWindow`（不依赖 origin）**、zod 校验消息、上报的
`block_id` 必须对 workspace inventory **复核**后才成为编辑目标（防伪造 postMessage）。
payload **预留元素级锚点**（选中元素 outerHTML/tag/文本片段），使 v1 块级、后续元素级
无需破坏契约：

```ts
data-artifact-edit-target:
  { document_id, revision_id, block_id, base_version_id, title,
    anchor?: { tag, text, outer_html } }
```

用户输入修改要求后，Agent 获得精确目标与前置版本，直接走 `scope: "anchor"`。

### Post-edit verification

发布前在 executor 执行（合并后的单一校验器）结构、CSS scope、链接、chart 校验，以及
**跨版本不变式**：老块 v1 + 新块 v2 的 `id`/`data-block-id` 不得撞、`#page-N` 作用域跨
版本稳定（否则继承旧块样式会崩）。完成后预览重载新 revision、滚动到原 block 并保持
选中状态。

## 6. Close-out

- 更新 ADR-0012/0015，明确 source graph、`current_revision_id` 指针、线性 revision、
  锚定编辑契约、CREATE/EDIT 分离的失败语义与 block selection 协议；引用 ADR-0022
  说明并发模型（扁平独立 + 原生重试，无 DAG）被沿用/强化。
- 更新 `schemas/streaming/chat-uimessage-stream.md`，登记 `data-artifact-edit-target`
  （对齐 `data-plan-execution` 先例）。
- 验证：
  - 大文档真实并发（provider 限流内），单块瞬断由 step 重试吸收；重部署中途按已完成
    版本跳过、不重跑。
  - 锚定编辑确定性：改一个数字，其余字节完全不变、产出可复核 hunk；`old_string` 不
    唯一/未找到时响亮 conflict。
  - 块自读取后被改动→stale `base_version_id` 返回 typed conflict；错误/重复/空 block ID
    不产生 revision。
  - EDIT 目标块失败不覆盖旧 revision（保 published）；CREATE 单块失败仍发布并可见
    error section。
  - 同文档双编辑：`SELECT FOR UPDATE` + `base_revision_id` 复核下只有一方成功。
  - 伪造的 postMessage（source 非预览 iframe、或 block_id 不在 inventory）被拒。
- 使用浏览器在桌面和移动视口点选、编辑、重载并截图检查。
- 运行 `just sync`、affected builds 和 `just lint`；demo 阶段不新增测试脚手架。
- 默认“点选 block 锚定编辑”；元素级锚点在 payload 预留、v1 在块粒度落地；任意块内 DOM
  节点级编辑器不进入本轮范围。
