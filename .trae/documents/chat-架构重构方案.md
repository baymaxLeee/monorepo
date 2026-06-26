# chat 服务全栈重构方案（激进版：迁移到 AI SDK v7 + WorkflowAgent）

## Context（为什么做这件事）

`apps/backend/services/chat` + `apps/frontend/apps/chat` 这套以 Vercel AI SDK
为核心的实现，核心骨架方向是对的，但三轮 review 暴露了一批**架构偏离 + 实现
bug**。用户最终拍板走**激进路线**：早晚要迁 v7，现在就迁——把 run 宿主从
`ToolLoopAgent`（v6，进程内、崩溃即丢）整体翻转为 **`WorkflowAgent`（v7，durable、
可恢复、HITL 跨挂起存活）**，并为其外挂自托管 Postgres World；业务库暂留 MySQL，
全量 PG 迁移留作后续 ADR。

这份方案以 **AI SDK v7 稳定版（2026-06-25 发布）+ Workflow DevKit** 官方文档为唯一
依据（已逐条 live 核实），不再走上一版的「resumable-stream + 保留 v6」保守路线
（该路线随 WorkflowAgent 自带 `WorkflowChatTransport` 而**整体作废**）。

---

## 决策（已确认，激进版）

| # | 决策点 | 采用 | 备注 |
|---|---|---|---|
| D1 | Run 宿主 | **`WorkflowAgent`（`@ai-sdk/workflow`，AI SDK v7）** | 翻转原 v6 ToolLoopAgent 决策 |
| D2 | 可重放流 | **官方 `WorkflowChatTransport` + `getRun(runId).getReadable()`** | **不再用 `resumable-stream` 包**，删自研 Redis 流层 |
| D3 | 构建系统 | **Nitro（`workflow/nitro` 模块）替换 `tsc`/`tsx`** | WDK 在 Hono 上的官方唯一集成路径，硬前提 |
| D4 | durable 后端（World） | **自托管 Postgres World（`@workflow/world-postgres`）** | 本地开发用 Local World（`.workflow-data/`，零配置） |
| D5 | 业务库 | **暂留 MySQL**；PG 仅给 Workflow World 单独挂实例 | 全量 MySQL→PG 迁移（15 migration / 6 服务）另开 ADR |
| D6 | 版本路由（Blocker #2） | **本次先欠账**，写 ADR；自托管 k8s 上接受 version-skew 风险 | 解法 = `@platformatic/world` 或自建版本钉扎队列，不在本次范围 |
| D7 | HarnessAgent | **本次不接入**（experimental + 纯负债），仅写 ADR 留接口位 | agent 宿主抽象预留 harness 入口 |
| D8 | tool 改造 | **execute 全部标 `'use step'`；context 仅传可序列化数据** | v7 序列化硬约束，见 Blocker #3 |
| D9 | HITL | **tool 上 `needsApproval`**（替换 executeless `ask_user` + addToolOutput） | 挂起跨进程重启存活 |
| D10 | 服务间调用 | **生成 client（`openapi-typescript`+`openapi-fetch`）+ 共享 transport** | fetch 必须落在 `'use step'` 内（sandbox 无 fetch） |
| D11 | provider 缓存 | **Redis 短 TTL + pub/sub 失效**（替换进程内 Map） | 对齐 AGENTS.md admin 域规范 |

---

## 已核实的架构级硬约束（plan 据此设计）

> 全部来自 live v7 / WDK 官方文档，非记忆。

1. **构建系统强制换 Nitro**（[WDK Hono 指南](https://useworkflow.dev/docs/getting-started/hono)）：
   Hono 需装 `workflow nitro rollup`，`nitro.config.ts` 挂 `modules:["workflow/nitro"]`
   才能编译 `'use workflow'`/`'use step'` 指令；scripts 改 `nitro dev`/`nitro build`，
   产物 `.output/server/index.mjs`，workflow route 生成在 `.well-known/workflow/v1/*`。
2. **流式协议翻转**：从「`createAgentUIStreamResponse` 消费返回流」→「workflow 内
   `agent.stream({ messages, writable: getWritable<ModelCallStreamPart>() })`」，
   route 里 `run.readable.pipeThrough(createModelCallToUIChunkTransform())`。
   且 `WorkflowAgent.stream` 收 `ModelMessage[]`，需先 `convertToModelMessages`。
3. **context 序列化硬约束**：`runtimeContext`/`toolsContext` **禁止**放 model 实例、
   SDK client、`AbortSignal`、DB client，只能放可序列化数据（string/number/对象…）；
   非序列化资源在 `'use step'` 内重建。当前 [AgentToolContext](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/agent-tools.ts) 塞了
   `generateModel`/`multimodalProvider`/`runAbortSignal`，**全部要改造**。
4. **sandbox 限制（Blocker #3）**：`'use workflow'` 函数跑沙箱 VM（无 `fetch`/
   `setTimeout`/Node modules），只有 `'use step'` 有完整 Node 访问。当前
   [agent-runtime.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/agent-runtime.ts) + [agent-tools.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/agent-tools.ts) 的 ioredis/drizzle/fetch I/O 全要外提成 step。
5. **逐 token 流式 artifact 是重设计（Blocker #4）**：`create_artifact`/`update_artifact`
   现为 `async function*` 逐 token yield；durable step 是 input→output 一次性记录，
   token 级 yield 不映射单 step。需改用 v7「Streaming Updates from Tools」（tool 内
   `getWritable()`）或降级为 step 一次性产出 + 单独流式段。
6. **resumable 由 `WorkflowChatTransport` 接管**：POST 回 `x-workflow-run-id`，GET
   `{api}/{runId}/stream` 用 `getRun(runId).getReadable({startIndex})`。**自研
   [agent-streams.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/agent-streams.ts) 整文件删除**。
7. **版本路由（Blocker #2，最致命且 PG 救不了）**：WDK 靠确定性重放，自托管 k8s
   部署新版本→旧 run 重放错位→静默数据损坏（[Platformatic 分析](https://blog.platformatic.dev/durable-workflows-kubernetes-version-safe)）。
   **本次 D6 接受风险并写 ADR**，未来上 `@platformatic/world` 解决。

---

## Phase 0 — 构建系统切换到 Nitro（D3，硬前提，先做）

文件：[package.json](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/package.json)、[Dockerfile](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/Dockerfile)、[index.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/index.ts)、[tsconfig.json](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/tsconfig.json)

- 装依赖：`@ai-sdk/workflow`、`workflow`、`nitro`、`rollup`（保留 `ai` 升到 v7 线）。
- 新建 `apps/backend/services/chat/nitro.config.ts`：
  `defineConfig({ modules:["workflow/nitro"], routes:{ "/**":"./src/index.ts" } })`。
- `package.json` scripts：`dev:"nitro dev"`、`build:"nitro build"`、
  `start:"node .output/server/index.mjs"`、`lint:"tsc -p tsconfig.json --noEmit"`。
- `tsconfig.json` 加 `compilerOptions.plugins:[{ "name":"workflow" }]`（IntelliSense）。
- [index.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/index.ts)：移除 `@hono/node-server` 自起 `serve(...)`，改为 `export default app`
  交给 Nitro 托管；`SIGINT/SIGTERM` 的 `closeDb`/`closeRedis` 收尾迁到 Nitro 生命周期
  钩子或保留为 lib 级 cleanup。
- [Dockerfile](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/Dockerfile)：builder 阶段 `npm run build`（=`nitro build`）；runtime 阶段
  `COPY --from=builder /app/.output ./.output`，`CMD ["node",".output/server/index.mjs"]`。
- **迁移安全验证**（AGENTS.md 硬规则）：[Procfile.dev](file:///Users/bytedance/projects/project/monorepo/Procfile.dev#L11) 的
  `svc-chat: pnpm dev` 脚本名不变（底层换 Nitro）；端口 8009 不变；
  [apps/backend/justfile](file:///Users/bytedance/projects/project/monorepo/apps/backend/justfile#L6) `NODE_SERVICES:="chat"` 不变。跑 `just install`/`just dev`/
  `just build chat` 三件套确认不破。

---

## Phase 1 — Postgres World 基础设施（D4/D5）

- [docker-compose.yml](file:///Users/bytedance/projects/project/monorepo/docker-compose.yml)：新增 `postgres`（仅供 Workflow World），
  独立 volume/端口（如 5432），**不动现有 mysql/redis**。
- [config.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/config.ts)：新增 `workflowDatabaseUrl`（`DATABASE_URL`）、
  `workflowTargetWorld`（`WORKFLOW_TARGET_WORLD`，部署设 `@workflow/world-postgres`）；
  本地不设 → 自动 Local World（`.workflow-data/`）。
- `.env.example`（chat 服务 + root，**Forbidden zone 仅改 example**）：补
  `DATABASE_URL` / `WORKFLOW_TARGET_WORLD`。
- `.gitignore`：加 `.workflow-data/`。
- **明确边界**：业务表（messages/conversations/agent_runs…）仍走 MySQL（
  [db/index.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/db/index.ts)）；PG 只存 workflow run/step/event/hook 状态。
- **Blocker #2 欠账**：自托管 k8s 版本路由不在本 phase；ADR 记录风险 + 未来
  `@platformatic/world` 方案。

---

## Phase 2 — run 宿主翻转为 WorkflowAgent（D1/D2，删自研流层）

**新建 `apps/backend/services/chat/src/workflows/chat-agent.ts`**
- `export async function runChatAgent(modelMessages, runtimeContext) { 'use workflow';
  const agent = new WorkflowAgent({ model, instructions, tools, runtimeContext,
  toolsContext, stopWhen, prepareStep, prepareCall });
  const result = await agent.stream({ messages: modelMessages,
  writable: getWritable<ModelCallStreamPart>() }); return { messages: result.messages }; }`
- `instructions` 在 `prepareCall`/外部构建（见 Phase 4 文档检索修复）。
- `stopWhen`：用 `isStepCount(N)` + `isLoopFinished()` 组合（替换
  `artifactPersistedStopCondition`，语义平移）。

**改造 [routes/agents.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/routes/agents.ts)**
- POST `/:conversationId/agents/run/stream`：`const run = await start(runChatAgent,
  [convertToModelMessages(messages), ctx])`；返回
  `createUIMessageStreamResponse({ stream: run.readable.pipeThrough(
  createModelCallToUIChunkTransform()), headers:{ "x-workflow-run-id": run.runId } })`；
  把 `run.runId` 落库到 `agent_runs`。
- GET `/:conversationId/agents/run/stream/:runId`（或 `{api}/{runId}/stream`）：
  `getRun(runId).getReadable({ startIndex }).pipeThrough(createModelCallToUIChunkTransform())`。
- cancel 端点：保留 `/agents/run/cancel`，改用 WDK run 取消 API（不再 200ms 轮询）。

**删除（被 WDK 取代）**
- 整文件删 [agent-streams.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/agent-streams.ts)（含 `AgentStreamService`、手写 XADD/XREAD、
  `appendEvent`/`appendEventDelta`/`streamEvents`/`shouldStop`、active hash 等）。
- 删 [routes/agents.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/routes/agents.ts) 的 `consumeReplayStream`/`replaySseResponse`/`startRun`
  分支。
- [index.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/index.ts) 去掉 `closeRedis`（若 Redis 仅用于流层；provider 缓存仍用则保留）。

**直接消除的 bug**：#1（active 无 TTL 死锁）、#2（check-then-set 竞态）、
#6（每 token Redis 往返）、#7（stream 泄漏无 MAXLEN）、#11（200ms 轮询取消）——
全部因删除自研流层 + WDK 托管而消失。

---

## Phase 3 — tools 改造：execute 标 `'use step'` + 序列化 context（D8/D9，Blocker #3/#4）

文件：[agent-tools.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/agent-tools.ts)、[agent-runtime.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/agent-runtime.ts)

- **保留 100%**：纯函数 `normalizeArtifactContent`/`validateArtifactContent`/
  `artifactSystemPrompt`/`sanitizeFilename`/`withProviderBody`/`decodeArtifactEscapes`/
  `stripMarkdownFences`/`extractPrimaryHtmlDocument`/`wrapHtmlShell` + 所有 tool 的
  `inputSchema`/`description`。
- **context 去 SDK 实例（Blocker #3）**：[AgentToolContext](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/agent-tools.ts) 删
  `generateModel`/`multimodalProvider`/`runAbortSignal`；改用 `toolsContext` 传可
  序列化数据（`userId`/`conversationId`/`providerId`/`multimodalProviderId`/
  `artifactTotalChars`）。
- **每个 execute 标 `'use step'`**：`list_documents`/`read_document`/`analyze_image`/
  `web_search`（Tavily fetch）/`create_artifact`/`update_artifact`/`propose_memory`
  的 I/O（knowledge/admin fetch、drizzle、tavily）全落 step 内；step 内
  `getProvider(providerId)` + `createOpenAICompatible` 重建 model client。
- **artifact 逐 token 流（Blocker #4）**：`create_artifact`/`update_artifact` 从
  `async function*` 改为 v7「Streaming Updates from Tools」——execute 内
  `getWritable()` 写流式中间态，step 返回最终持久化结果（input→output）。
- **HITL（D9）**：`ask_user` executeless tool → tool 上 `needsApproval:true`
  （或条件式 `needsApproval: async (input)=>…`），workflow 挂起跨重启存活；
  前端配合 Phase 5 的审批 UI。

---

## Phase 4 — agent-runtime 清理与可观测修复（原 #3/#4/#5/#8/#9/#10）

文件：[agent-runtime.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/agent-runtime.ts)、[conversations.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/conversations.ts)

- **去 `as any`**（L286/L383/L390）：随 WorkflowAgent 正确类型 + context 改造自然消除；
  lint = `tsc --noEmit` 必须零 `as any`。
- **#8 messages 重复查询**：`buildInstructions` 复用已加载消息，删二次 `listMessages`。
- **#9 整篇文档塞 prompt**：移除 L203-218 全量 `content_md` 注入，仅留元信息
  （title/id），正文交 `read_document`/`list_documents` 按需检索；去
  `skipConversationSummary` 双路径。
- **#3 只记终态 / durationMs=null**：改用 **WDK step 边界**做 per-step 可观测
  （workflow dashboard 原生）；`agent_steps`/`agent_tool_calls` 在 step 进入/退出
  记录真实 start/finish + `durationMs`。
- **#4 totalTokens 不落库**：聚合各 step usage，`finishAgentRun` 传 `totalTokens`
  （列已存在 [schema.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/db/schema.ts#L42)）。
- **#10 fire-and-forget 打满连接池(8)**：持久化写现落在 durable step 内（天然有界、
  可重试）；保留 `connectionLimit`/`queueLimit`/`connectTimeout` 调参。
- **#5 静默吞错**：[getConversation](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/services/conversations.ts#L137) 的 knowledge `catch{documentRows=[]}`
  改为记录日志 + 返回部分失败标记。

---

## Phase 5 — 服务间调用：生成 client + 共享 transport（D10/D11）

- 新建 `apps/backend/pnpm-workspace.yaml`（纳入 `services/chat` + `libs/transport-ts`）；
  验证 `just install`/`just dev`/`Dockerfile` 仍解析依赖。
- 新建 `apps/backend/libs/transport-ts`：超时 + `AbortSignal`、幂等 GET 重试退避、
  `X-Internal-Token` 注入、tracing header 透传、错误映射（`AdminUnavailableError`/
  `ProviderNotConfiguredError`/`NotFoundError`）。**所有调用必须在 `'use step'` 内**
  （sandbox 无 fetch）。
- `openapi-typescript`+`openapi-fetch` 从 [admin-server.json](file:///Users/bytedance/projects/project/monorepo/schemas/openapi/admin-server.json)、
  `knowledge-server.json` 生成类型/client；删 [admin.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/clients/admin.ts) 手抄
  `ProviderSnapshot`、[knowledge.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/clients/knowledge.ts) 手抄 `KnowledgeDocument`/`DocumentSlice`。
- 接入 `just sync`（[apps/backend/justfile](file:///Users/bytedance/projects/project/monorepo/apps/backend/justfile) 加后端 client 生成步骤）。
- **provider 缓存（D11）**：[admin.ts](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/src/clients/admin.ts#L16) `new Map()` → Redis 短 TTL + 订阅失效；
  **admin 侧（Python）**写操作后 `DEL`+`PUBLISH`（跨服务，纳入本次）。

---

## Phase 6 — 前端：WorkflowChatTransport + AI Elements 套件（D2/D7 前端侧）

- **删 [ChatRoomPage.tsx](file:///Users/bytedance/projects/project/monorepo/apps/frontend/apps/chat/src/pages/ChatRoomPage.tsx)（1704 行手搓 UI），不移植。**
- [Chat.tsx](file:///Users/bytedance/projects/project/monorepo/apps/frontend/apps/chat/src/pages/Chat.tsx) 作为唯一页面，`useChat` 的 transport 换
  **`WorkflowChatTransport`**（`api`、`maxConsecutiveErrors`、`initialStartIndex:-50`）；
  `onChatEnd` 把最终 messages PUT 回后端持久化（对齐 WDK「single-turn + 客户端
  owns history」模式）。
- 缺失能力用官方 AI Elements 套件重建（`packages/components/src/AiChat/`）：
  `ModelSelector`（修 [Chat.tsx](file:///Users/bytedance/projects/project/monorepo/apps/frontend/apps/chat/src/pages/Chat.tsx#L171) 硬编码空值）、`PromptInput`/`Attachments`
  （真实 `document_ids`）、`PromptInputToolbar`（multimodal/thinking/effort）、
  `Reasoning`、`Tool`、`Artifact*`、`streamdown`。
- HITL：`needsApproval` 审批请求 → 套件审批 UI 回填。
- 删仅 ChatRoomPage 用的非官方组件（`components/prompt-input` token 版、
  `markdown-editor`、页面层 `streamdown` 直引）——先 grep 确认无其他引用。
- 约束：单文件 <800 行、render <200 行；复杂逻辑拆 `useXxx`。

---

## Phase 7 — AGENTS.md / ADR 同步

- 更新 [chat AGENTS.md](file:///Users/bytedance/projects/project/monorepo/apps/backend/services/chat/AGENTS.md)：表清单改实际 6 张；登记
  WorkflowAgent/Nitro/PG World/WorkflowChatTransport/Redis 缓存约定。
- 更新前端 [chat AGENTS.md](file:///Users/bytedance/projects/project/monorepo/apps/frontend/apps/chat/AGENTS.md)：移除 ChatRoomPage 现役描述。
- 更新 [schemas/codegen/README.md](file:///Users/bytedance/projects/project/monorepo/schemas/codegen/README.md)：补后端 TS client 生成位置。
- 新增 ADR（逐项）：
  1. 迁移到 AI SDK v7 + `WorkflowAgent` 作为 run 宿主。
  2. 自托管 Postgres World；**Blocker #2 版本路由欠账**（未来 `@platformatic/world`）。
  3. Nitro 构建系统替换 tsc/tsx。
  4. `WorkflowChatTransport` 取代 resumable-stream / 自研流层。
  5. **HarnessAgent 未来接入**（本次不装包，预留宿主抽象入口）。
  6. **全量 MySQL→Postgres 迁移**作为未来 epic（15 migration / 6 服务）。
  7. TS transport 层 + Redis+pubsub 缓存 + 前端收敛。

---

## 验证（端到端）

1. `just lint chat`（`tsc --noEmit` 通过，无 `as any`）。
2. `nitro build` 成功，产物 `.output/server/index.mjs` 可 `node` 启动。
3. `just install`/`just dev`/`just build chat` 三件套不破（迁移安全）。
4. `just sync` 后前后端均 build。
5. `just dev` 起栈（含新 postgres + 本地 Local World），浏览器走查：
   - 黄金路径：发消息→流式→工具卡片→artifact 生成。
   - **resume**：流式中刷新页面，`WorkflowChatTransport` 续读（验证 #1/#2/#7）。
   - **crash 恢复**：杀 chat 进程重启，run 从 step checkpoint 续跑（WorkflowAgent 核心收益）。
   - **HITL**：`needsApproval` 挂起→重启后仍可批准回填（验证 D9 跨挂起存活）。
   - **cancel**：取消端点中断（验证 #11）。
   - provider 切换、multimodal、thinking/effort、文档附件全部生效。
6. `npx workflow inspect runs` 能看到 step 级执行轨迹（验证可观测 #3）。
7. 逐条核对下表。

## 问题核对表（重构后逐条回归）

| # | 问题 | 归属 Phase | 处置 |
|---|---|---|---|
| 1 | active key 无 TTL，崩溃永久锁死 | P2 | 删自研流层 → 消失 |
| 2 | startRun check-then-set 竞态 | P2 | WDK run 机制 → 消失 |
| 3 | steps/tool_calls 只记终态、durationMs=null | P4 | WDK step 边界记录 |
| 4 | total_tokens 采集未落库 | P4 | 聚合 step usage 落库 |
| 5 | getConversation 静默吞 knowledge 错误 | P4 | 日志 + 部分失败标记 |
| 6 | 每 token 一次 Redis 往返 | P2 | 删自研流层 → 消失 |
| 7 | Redis stream 泄漏 + 无 MAXLEN | P2 | WDK World 托管 → 消失 |
| 8 | messages 被查两遍 | P4 | 复用已加载消息 |
| 9 | 整篇文档塞 system prompt | P4 | 仅元信息 + 工具按需检索 |
| 10 | fire-and-forget DB 写打满连接池(8) | P4 | durable step 内有界写 |
| 11 | 取消用 200ms 轮询 | P2 | WDK run 取消 API |

## 风险与欠账（明确登记，非遗漏）

- **Blocker #2（版本路由）**：自托管 k8s 部署新版本可能令在飞 run 重放错位、静默
  损坏数据。本次接受风险（demo 部署频率低、滞留 run 少），ADR 记录，生产前必须上
  `@platformatic/world` 或自建版本钉扎队列。
- **v7 / WDK 成熟度**：v7 稳定版 2026-06-25 发布，WDK 生态尚浅；`WorkflowAgent`
  无 `generate()`（stream-only）。
- **全量 MySQL→PG**：本次不做，仅给 Workflow 单挂 PG；全迁是独立 epic。
