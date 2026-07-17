# Agent 扩展体系：MCP / Skill / SubAgent（admin 管理 · chat 消费）

> 状态：**Skill 已端到端落地，以 `docs/plans/skill-mcp-assembly-plan.md` + ADR-0033 为准**（本文件的
> Skill 段落已过时）。**MCP 预留**（同上文档）。**本文件仅 SubAgent 部分仍有效**。
>
> 历史归属边界：`docs/plans/prompt-engineering-plan.md` 负责提示词分层与薄 router 缝（ADR-0032，
> 结构化 Bot profile + `InstructionContributions` 已落地）。Skill 已把 `workflow: string[]` 升级为
> renderer 生成的 `<available_skills>`（`SkillListing`），并统一系统 + admin 技能到单一 `load_skill`。
>
> 已拍板决策：挂载 = **Bot 聚合根**；SubAgent = **内联短时**（不碰 executor）；MCP = **首次调用需审批**。

## 概述

在**不重构主 agent**的前提下，为 chat 接入三类可由 admin 配置、按 bot 挂载、由 chat 运行时消费
的能力扩展：

- **Skill**：渐进披露的"怎么做"（指令 + 可选工具）。
- **MCP**：接入外部系统的工具集（远端 server）。
- **SubAgent**：把子任务委派给拥有独立 context 的专才，回传压缩摘要。

核心判断：**这不是从零搭建，而是"设计已定、系统 Skill 已落地、管理面待补"**。扩展缝隙
（`AgentExtension` / `ToolCatalog`）、运行时（AI SDK v7 `ToolLoopAgent`）、长任务载体
（executor + `TaskType`）、admin→chat 消费范式（provider 加密下发）、前端管理/消费范式
（ScenesPage / provider 选择）全部就位。三者接入是"顺着骨架填肉"。

## 背景与延续性（现状盘点）

### 已就位（省钱根源）

- **扩展缝隙与系统 Skill 已落地**：
  - `agent/integrations/types.ts` 的 `AgentExtensionContribution` 三字段
    `{ tools?, instructions?, dispose? }` 精准匹配 MCP（tools+close）、Skill（instructions+tools）。
  - `agent/integrations/skills/provider.ts` 注册代码版本化系统 Skill；普通 run 只注入
    name+description，通用 `load_skill` 按需读取 `SKILL.md` 全文。
  - `agent/integrations/mcp/provider.ts` 保留 run-scoped extension 工厂，真实 MCP client 待 Phase 2。
- **工具目录按 run 解析**：`agent/tools/catalog.ts` 的 `ToolCatalog.resolve(context)` 拿到
  `{mode, runId, userId, conversationId}`，是正确接入点。
- **运行时**：`agent/agents/tool-loop.ts` 使用 backend workspace catalog 管理的
  AI SDK 7 `ToolLoopAgent`，支持
  `toolApproval` / `activeTools` / `toolOrder` / `pruneMessages`。
- **长任务载体**：`executor` 服务（真 Workflow DevKit + `TaskType` 注册表），
  ADR-0015 已预留 "harness 执行引擎接同一 `TaskType` 契约" —— 长时 SubAgent 的家。
- **消费范式（provider 黄金模板）**：admin 内 Fernet 加密落库（`api_key_enc`）、`mask()` 公开、
  `decrypt()` 仅在 `/internal/*` 下发；`X-Internal-Token` 鉴权；`assertPublicProviderUrl` 防 SSRF。
- **Bot 正在成为聚合根**：`migrations/versions/v1.5.0.sql` 已给 `bots` 加
  `text_provider_id / image_provider_id / video_provider_id / updated_at` —— provider 已挂 bot。
  **skill/mcp 沿用同一方向即可。**
- **前端范式**：admin CRUD 参考 `ScenesPage.tsx`（含 is_enabled/status/批量删除）；
  chat 消费参考 `useChatStore` + `ChatComposerControls` + `ModelSelector` + `requestBody` 注入。

### 已消除的关键隐患（ADR-0028）

原 `defaultToolCatalog` 是进程级模块单例，违反 `agent/README.md` 的租户隔离要求。
ADR-0028 已删除该单例和全局注册 API；每次 `createToolLoopAgent` 默认构造独立 `ToolCatalog`。

### 官方 / benchmark 对齐（已查证，非记忆）

- **MCP**：`createMCPClient` 已转正，迁到独立包 **`@ai-sdk/mcp@2.0.5`**（peer `zod ^3.25.76`，
  与本仓一致）。核心 `ai` 不再内置 MCP。生产推荐 **HTTP(StreamableHTTP)/SSE** 传输，`stdio` 仅本地。
  `client.tools({ schemas })` 可**白名单筛选**工具；用完必须 `close()`；轻量客户端不支持
  session 持久化/断点续传/通知。→ 完美对应 `AgentExtension`（tools + dispose）与 README"必须筛选"。
- **Skill**：Anthropic/Claude Code 的 **文件夹 + `SKILL.md`（YAML: name/description）** +
  **渐进披露**（启动只加载 name+description ~100 tokens，命中才读全文，再按需读子文件）。
  `allowed-tools` 限权，`disable-model-invocation` 手动触发。→ 直接照搬到 DB 存储 + 指令注入。
- **SubAgent**：独立实例、独立 context window、独立工具权限，**tool delegation 委派只回传摘要**。
  与 `agent/README.md` "Subagent 通过 tool delegation 运行独立 context，返回压缩 `toModelOutput`" 逐字吻合。
- **三者边界**：Skill=教"怎么做"；MCP=接"外部系统"；SubAgent=把活外包给带独立上下文的专才。选错会放大成本。

## 设计总纲（贯穿所有 Phase）

1. **Per-run 组合，不用全局单例**：composition root（`run.ts`）装配 `AgentExtension[]`，
   在 `createToolLoopAgent` 内 `new ToolCatalog()`。落实 README 的租户隔离要求。
2. **Bot = 能力聚合根**：provider（已挂）/ skill / 后续 mcp / subagent 都挂 bot；
   chat run 带 `bot_id`，一次聚合拉取。
3. **渐进披露（Skill 灵魂）**：只注入 `name+description`（L1）；命中后由 `load_skill` 按需拉全文（L2）。
4. **admin 管、chat 消费、密钥不外泄**：照抄 provider；有密钥资源（MCP token）复用 Fernet `*_enc`，仅 `/internal` 下发。
5. **工具命名空间 + 显式筛选**：外部来源工具（MCP）强制前缀 `mcp__<server>__<tool>` + 白名单；catalog 撞名报错保留为兜底。

---

## Phase 0 — 运行时地基（per-run ToolCatalog）

目标：把"扩展注入"从全局单例改成按 run 组合。纯 chat TS 改动，不碰 DB/前端，`tsc` 独立验证。

| 文件 | 改动 |
|---|---|
| `agent/tools/catalog.ts` | 删除 `export const defaultToolCatalog`；`ToolCatalog` 类保留可实例化 |
| `agent/agents/types.ts` | `ChatAgentInput` 增加 `extensions?: AgentExtension[]` |
| `agent/agents/tool-loop.ts` | 函数内 `const catalog = new ToolCatalog(); (input.extensions ?? []).forEach(e => catalog.register(e));` 再 `resolve` |
| `agent/integrations/namespace.ts`（新） | `namespaceContribution(prefix, contribution)`：给 tools 键加前缀防撞名 |
| `agent/integrations/mcp/provider.ts` | 改为工厂 `createMcpExtension(cfg): AgentExtension`（Phase 2 填真实 client） |
| `agent/integrations/skills/provider.ts` | 改为工厂 `createSkillExtension(cfg): AgentExtension`（Phase 1 填实现） |
| `agent/integrations/index.ts`（新） | 组合根 `resolveRunExtensions(ctx): Promise<AgentExtension[]>`，Phase 0 先返回 `[]` |
| `agent/runs/run.ts` | 调 `createAgent` 前 `const extensions = await resolveRunExtensions({...})` 传入；`dispose` 链路已有 |
| `agent/index.ts` | 导出改名：`createMcpExtension` / `createSkillExtension` / `resolveRunExtensions` |

数据流（改造后）：

```
run.ts
  → resolveRunExtensions({userId, conversationId, botId, mode})   // Phase 0: []
  → createAgent({ ...input, extensions })
    → createToolLoopAgent
      → new ToolCatalog()               // 每 run 独立
      → register(...extensions)
      → resolve({mode,...})
      → new ToolLoopAgent({ tools, instructions, ... })
  → onEnd: agentInstance.dispose()      // 关闭 MCP 连接等（已有兜底）
```

验收：`cd apps/backend && just lint chat` 通过；extensions 为空 → 现有对话行为零变化。

---

## Bot 聚合根改造（Phase 1 前置）

v1.5.0 已让 bot 挂 provider（3 个 nullable 列）。skill 是 1:many，用**显式关联表**（符合
`apps/backend/AGENTS.md`"资源分模块，勿合并通用表"）。

### 数据模型（admin，新增于 v1.6.0）

```
bot_skills (
  bot_id    varchar(32),   -- bots.id 语义 FK
  skill_id  varchar(32),   -- skills.id 语义 FK
  sort      int,           -- 可选排序
  PRIMARY KEY (bot_id, skill_id),
  KEY ix_bot_skills_bot_id (bot_id)
)
```
> Phase 2 会再加 `bot_mcp_servers`，同款显式模式，清晰可演进。

### 内部聚合快照 API（admin，新增）

`GET /internal/bots/{bot_id}?user_id=...` → `InternalBotSnapshot`：

```jsonc
{
  "id": "...", "user_id": "...", "name": "...", "status": "published",
  "text_provider_id": "...", "image_provider_id": null, "video_provider_id": null,
  "skills": [ { "id": "...", "name": "pdf-report", "description": "..." } ]
  // 只带 skill 的 name+description（L1），不带 body → 渐进披露
}
```
鉴权同 provider：`InternalCaller`（`X-Internal-Token`）+ `user_id` 归属校验。

---

## Phase 1 — Skill 资源（admin 管理 → 挂 bot → chat 消费）

### A. admin 后端（照抄 provider；无密钥更简单）

| 文件 | 内容 |
|---|---|
| `migrations/versions/v1.6.0.sql` | 建 `skills` + `bot_skills`；`UPDATE migration SET version='v1.6.0'` |
| `models/skill.py` | `SkillRow`：id, user_id, name, description, body(mediumtext), status, is_enabled, created_at, updated_at |
| `models/bot_skill.py` | `BotSkillRow`：bot_id, skill_id, sort |
| `schemas/skill.py` | `Skill`（公开）、`InternalSkill`（含 body）、`SkillCreate/Update` |
| `crud/skills.py` | list/get/create/update/delete + `get_internal(id, user_id)` |
| `crud/bot_skills.py` | attach/detach/list_by_bot |
| `services/skills.py` | name 唯一(作 slug)、to_public/to_internal |
| `services/bots.py`（改） | bot 快照聚合：拼 skills(name+description) + 已有 provider 列 |
| `routers/skills.py` | 公开 CRUD `prefix="/skills"`，`CurrentUser` |
| `routers/skills_internal.py`（新） | `GET /internal/skills/{id}` 返回含 body 的 `InternalSkill`（`load_skill` 用） |
| `routers/bots.py`（改） | bot 详情增 attach/detach skill 子路由 |
| `routers/bots_internal.py`（新） | `GET /internal/bots/{id}` 聚合快照 |
| `main.py` / `db.py` | include 新 router、import 新 model |

`skills` 表结构：

```
skills (
  id           varchar(32) PK,
  user_id      varchar(26) index,
  name         varchar(100),      -- 唯一 slug，作调用名
  description  varchar(1024),     -- 触发信号（L1，注入 context）
  body         mediumtext,        -- 完整 SKILL.md（L2，load_skill 时取）
  allowed_tools json NULL,        -- 可选：技能激活时限权（后置）
  status       varchar(20),       -- draft|active
  is_enabled   tinyint(1),
  created_at   datetime(6), updated_at datetime(6)
)
```

### B. 契约同步

- `just gen-openapi admin` → `schemas/openapi/admin-server.json`
- `just sync` → `packages/api/generated/admin-server/` + transport-ts
- `libs/transport-ts`：`AdminInternalClient.getBotSnapshot(userId, botId)`、`getSkill(userId, skillId)`

### C. chat 消费（核心）

| 文件 | 改动 |
|---|---|
| `routes/agents.ts` | `runSchema` 增 `bot_id: z.string().max(32).optional().nullable()`，透传 |
| `clients/admin.ts` | 增 `getBotSnapshot(userId, botId)`、`getSkillBody(userId, skillId)`（facade + 错误映射） |
| `agent/integrations/skills/provider.ts` | 实装 `createSkillExtension({ skills, userId })`：<br>• `instructions`：`<available_skills>` 每行 `- {name}: {description}` + 指令"匹配到技能先调 `load_skill(name)` 加载完整说明再执行"<br>• `tools.load_skill`：inputSchema `{name}`，execute 走 `getSkillBody` 返回全文作 `toModelOutput` |
| `agent/integrations/index.ts` | `resolveRunExtensions`：有 `botId` → `getBotSnapshot` → `createSkillExtension(...)`；无则 `[]` |
| `agent/runs/run.ts` | 把 `botId` 透进 `resolveRunExtensions` 与 `createAgent`；新建会话时 pin `bot_id`（仿 provider） |
| `db/schema.ts`（chat） | conversation 增 `bot_id`(可空) —— 需一条 chat 侧 migration |

**渐进披露落地**：注入的只有 name+description（每技能 ~几十 token）；全文只在 `load_skill`
被调用那一步进入 context。50 个技能也不撑爆窗口。

### D. 前端 admin（抄 ScenesPage）

- `packages/api/src/admin-server.ts`：补 `fetchSkills/createSkill/updateSkill/deleteSkill` + `attachBotSkill/detachBotSkill`
- `apps/admin/src/pages/SkillsPage.tsx`：列表 + Dialog 表单（name/description + body 用 Markdown 文本域）
- `apps/admin/src/router/index.tsx` + `AdminLayout.tsx`：加路由与菜单
- `apps/admin/src/pages/BotDetailPage.tsx`：加"技能"区块，勾选挂载/卸载

### E. 前端 chat

- 最小闭环：`useChatStore` 增 `bots`/`selectedBotId`(持久化) + `loadBots()`；
  `ChatComposerControls` 加 bot `ModelSelector`；`Chat.tsx` 的 `requestBody` 增 `bot_id`
- 可选：`/` slash 唤起技能列表（占位文案 `Chat.tsx` 已在）；本期可先靠模型自动匹配，不做交互

### F. 验收（DoD，demo 阶段免测试）

1. `just gen-openapi admin` + `just sync`，两端能 build
2. `just migrate-new admin v1.6.0` 后 `just up` 迁移通过
3. `just lint`（admin + chat + 前端）通过
4. 手测：admin 建技能 → 挂到 bot → chat 选该 bot → 提问命中 → 模型调 `load_skill` → 全文进上下文 → 按技能执行
5. 迁移安全：`just install/up/dev/build` 不破

---

## Phase 2 预告 — MCP（首次审批）

- 依赖：新增 `@ai-sdk/mcp@2.0.5`（chat）
- admin：`mcp_servers` 表（url、transport=http、`auth_header_enc` **Fernet 加密**、`allowed_tools` json、is_enabled）
  + `bot_mcp_servers` 关联 + `/internal/mcp-servers`
- chat：`createMcpExtension`：`createMCPClient({transport:{type:'http',url,headers}})` → `tools({schemas})` 白名单
  → 命名空间前缀 → `dispose=close()`；单 server 失败隔离降级；URL 复用 `assertPublicProviderUrl`(SSRF)
- 审批：`ToolLoopAgent.toolApproval` 对 `mcp__*` 首次调用需用户确认（前端审批卡），对齐 Cursor/Claude
- 前端：admin CRUD（带连通性测试，抄 provider test）+ bot 挂载 + chat 审批 UI

## Phase 3 预告 — 内联 SubAgent

- `agent/agents/subagent.ts`：`dispatch_subagent(task, scope)` 工具，内部 new 独立 `ToolLoopAgent`
  （独立 instructions + 受限工具集），跑完把**压缩摘要**作 `toModelOutput` 回主模型
- 独立 context window / 独立预算；取消信号复用 run `AbortSignal`；**不动 executor**
- admin 可选：`subagents` 表（name/description/instructions/allowed_tools）挂 bot

---

## 里程碑与工作量（单人全栈估算）

| 里程碑 | 内容 | 量级 |
|---|---|---|
| M0 | Phase 0 地基 + 命名空间 | ~1 人日 |
| M1 | Bot 聚合根(skill 部分) + Phase 1 Skill 全栈竖切 | ~4–6 人日 |
| M2 | Phase 2 MCP（含审批/降级/加密） | ~5–7 人日 |
| M3 | Phase 3 内联 SubAgent | ~3–4 人日 |

> ADR-0028 已交付 M0 与系统内置 Skill 竖切；admin 可配置、按 bot 挂载的 M1 管理面以及
> M2/M3 按需排期。

## 风险与回滚

- **Phase 0 触及热路径**：改动小，extensions 为空时行为等价；回滚还原相关文件即可。
- **chat 首次消费 bot**：后续管理面若落地，`bot_id` 全程可空；当前系统 Skill 不依赖 bot 选择。
- **迁移**：当前系统 Skill 不需要数据库迁移；后续 admin 可配置 Skill 再单独评审表结构。
- **上下文预算**：严格渐进披露 + 快照只带 L1，规避技能全文堆积。

## plan skill 六步自检

1. 批判性复核：`defaultToolCatalog` 单例违反自身 README，已由 ADR-0028 删除。
2. 官方对齐：`@ai-sdk/mcp` 现行 API、Skill 渐进披露、`toolApproval` 均查证源码/官方文档，非记忆。
3. Benchmark：Skill/SubAgent/MCP 边界照 Claude Code。
4. 单 agent 优先：主 agent 不变，SubAgent 仅 tool delegation，无 persona 剧场。
5. 直接重构：单例改 per-run，不加兼容层。
6. 收口：系统 Skill 决策见 ADR-0028；`just sync` / `just lint` 已纳入 DoD。

## 相关阅读

- `apps/backend/services/chat/src/bootstrap/application/agent/README.md` —— 扩展/runtime 边界（本方案的设计源头）
- `docs/ADR/0011-tool-loop-agent-core.md` —— 主 agent 用 ToolLoopAgent
- `docs/ADR/0015-agent-task-executor.md` —— 长任务 executor + `TaskType`（长时 SubAgent 的家）
- `schemas/streaming/chat-uimessage-stream.md` —— 流协议：优先复用官方 part
