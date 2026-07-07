# Skill / MCP 装配计划（admin 管理 · chat 消费 · `/` 唤起）

> 状态：**Skill 已端到端落地**（见 ADR-0033）；**MCP 预留**（未实装）。
>
> 归属边界：`prompt-engineering-plan.md` 只负责提示词分层与薄 router 缝（ADR-0032，结构化 Bot
> profile 已落地）。Skill/MCP 的管理与装配以本文件为准；`agent-extensions-mcp-skill-subagent.md`
> 仅保留 SubAgent 部分，Skill/MCP 以本文件与 ADR-0033 为准。

## 已交付（Skill 端到端）

目标：admin 配置技能 → 挂到 Bot → chat 选 Bot 后可 `/` 快速唤起并消费。

### admin（配置面）
- 表：`skills`（org 维度，字段贴合 Agent Skills 规范：`name` kebab-case 且作为模型调用名、org 内唯一；
  `description` L1；`body` L2 SKILL.md；管理字段 `status`/`is_enabled`）；`bot_skills`（Bot↔Skill 绑定）。
- 迁移 `admin v1.10.0`：**纯建表**（demo 数据在 `seed_demo_bots` 非生产播种）。
- 模型/schema/crud/service：`models/skill.py`、`models/bot_skill.py`、`schemas/skill.py`、
  `crud/skills.py`、`crud/bot_skills.py`、`services/skills.py`；`BotService` 增 `list_skills` /
  `attach_skill` / `detach_skill`，`get_resolved` 返回 `skills`（仅 active+enabled 的 L1）。
- 路由：公开 CRUD `/skills`（读 CurrentUser，写 org_admin）；`/bot/{id}/skills` 挂载/解绑；
  内部 `/internal/skills/{id}` 返回含 body 的 `InternalSkill`（内部 token 为信任边界）。
- 契约：`gen-openapi admin` + `sync` 重生 `schema/admin.ts` 与前端 client；transport-ts
  `AdminInternalClient.getSkill(id)` + `AdminInternalSkill`。

### chat（运行时/消费面）
- `resolveSkills(mode, adminSource)`：合并**系统 Skill（fs）+ admin Skill（bot 绑定）**为单一
  `load_skill`，按 name 合并（admin 覆盖同名系统 Skill），`load_skill` 拒绝未 advertise 的名字。
- `ChatAgentInput.botSkills` + `loadSkillBody` 经 `tool-loop` 透传 `catalog.resolve(ctx, providers, skillSource)`。
- `clients/admin`：`getAgent` 带 `skills`；新增 `getSkillBody(id)`（按需拉全文，渐进披露）。
- `/` 显式激活：请求带 `skill_name` → run 侧校验属于该 bot 后，加载全文注入
  `<activated_skill>` 上下文块（受信指令，非 untrusted document），保证**当轮必消费**；
  模型自主 `load_skill` 路径保留。
- routes：`agent_id`（既有）承载选定 Bot；`skill_name` 承载显式技能。**未新增
  `conversations.bot_id`**（前端已持久化 `selectedAgentId`，迁移保持最小）。

### 前端
- `packages/api`：Skill 类型 + CRUD + `fetchBotSkills`/`attachBotSkill`/`detachBotSkill`。
- admin MFE：`SkillsPage`（列表/新建/编辑，含 kebab-case 校验与 body 编辑）+ 菜单/路由；
  `BotDetailPage` 技能区块（挂载/解绑 + 未激活标记）。
- chat MFE：`Chat.tsx` 按 `selectedAgentId` 拉技能，`RichPromptInput.slashCommands` 提供技能
  作为 `/` 命令，选中后置 `activatedSkillName` 并进 `requestBody.skill_name`，发送后清空；
  `ChatComposerControls` 展示可移除的技能 chip。

### 兑现的历史遗留
- ADR-0032 里延后的「RCA 工作流交给 skill」已由 admin Skill 能力承载：运营可在技能页新建
  `oncall-rca`（body=四段 RCA 作战手册）并绑定到对应 bot。`seed_demo_bots` 不再内置任何
  demo oncall bot/skill —— 演示数据改由运营在 admin 自行录入，避免租户配置与内置数据混淆。

## MCP 预留（不实装）

保持现有缝隙不动，供后续 MCP 端到端使用：
- `AgentExtension` / `AgentExtensionContribution { tools?, dispose? }`（Skill 不再走此口，专供 MCP）。
- `ToolCatalog` 的 `mcp__server__tool` 命名空间与 dispose 生命周期。
- `policy.ts` 的 `mcp__*` 首次调用 user-approval。
- 待办（另起计划）：admin `mcp_servers` 表 + 凭据（Fernet）+ SSRF 防护 + 工具白名单；
  `@ai-sdk/mcp` client 接入；`ResolvedAgent` 增 `mcp` 挂载点；`resolveRunExtensions` 组装。

## 验收清单

- 建 Skill → 挂 Bot → chat 选 Bot → `/` 命中 → 全文进上下文并按技能执行。
- `<available_skills>` 只含 L1；全文不常驻；`load_skill` / `/` 均拒绝越权名。
- `just lint` / typecheck / `pnpm -F {admin,chat} build` / `just sync` / 迁移安全通过。
