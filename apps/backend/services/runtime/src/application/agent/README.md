# Runtime Agent Host

本目录是 Backend 对共享 `@repo/agent-runtime` kernel 的宿主实现。Session、run、journal、
lease、stream finalizer、云端 sandbox 和能力准入属于 Runtime；`RuntimeTurn`、AI SDK loop、
run-input queue、context projection/compaction 和 tool execution scheduling 属于 shared package。

```text
agent/
├── runtime/        # CloudTurn capability/model/tool/environment 组装
├── context/        # PostgreSQL checkpoint、文件授权投影、instructions 输入
├── adapters/       # Runtime Sandbox、Web Search、插件 Skill asset 与云端 execution host
├── tools/          # host catalog 与 Runtime 自有 Media/Memory manifests
├── runs/           # admission、插件 resolve/snapshot、lease、cancel、journal finalizer
├── streams/        # Redis-backed UIMessage SSE transport resume
├── tasks/          # 明确声明的 durable business tasks
├── memory/         # durable memory 与 extraction
└── observability/  # product run/step/tool lifecycle
```

## Runtime policy

- `runs/run.ts` 从 PostgreSQL journal 取得权威历史，经 `context/model-context.ts` 调用 shared
  context manager，再创建一个 `RuntimeTurn`。不得在 Backend 恢复私有 `ToolLoopAgent`、context
  projector/compactor 或 input queue。
- `runtime/cloud-turn.ts` 只冻结本 turn 的 model、tools、instructions、execution environment、
  sandbox 和 observation adapters。它不能拥有 Session lifecycle 或另建 tool loop。
- 必须跨进程、部署、重试或长期等待恢复的工作交给 Runtime worker Workflow。普通 Bash、文件
  修改、artifact 发布和短时 tools 留在交互 Turn；Turn 本身不是 Workflow run。
- Runtime 与 Desktop 使用 shared portable registry，再追加各自真实 host/领域 manifests。
  重名能力拒绝启动，不通过 profile 裁剪或替换公共工具。
- Knowledge、Canvas 与外部 MCP 都从 Admin 的 workspace installation 解析为 Turn snapshot；Runtime
  不固定绑定 platform plugins，也不 import 它们的业务 client。MCP connection 只由 shared
  `PluginManager` 在执行宿主内创建。

## Context and tools

- PostgreSQL UIMessage journal 是会话事实源；provider response cursor 仅在 provider/model 与
  journal lineage 都匹配且未到水位时用于增量调用。否则从 journal 重建。
- `context/model-context.ts` 只实现数据库 checkpoint CAS 与受权文件转换。budget、recent-tail、
  compaction state 和 fail-closed checkpoint 安装属于 shared context manager。
- `prepareStep` 只处理 provider stored continuation、workspace runtime facts 和观测；任何 override
  都必须保留 shared input queue 提供的 steering message。
- 每个 tool 通过自己的 `contextSchema` 获得最小权限数据。schema/description/planning metadata
  是工具局部契约；不要在 system prompt 重建工具 router 或 payload 文档。
- `runs/run.ts` 在任何模型调用或 MCP 连接前，用当前 IAM scope 和 activation 调 Admin resolve，
  先写入去除 connection grants 的 immutable `turn_plugin_snapshots`，再把 shared plugin manifests
  合入 `ToolCatalog`。grant 只在进程内存；加载失败、取消或 Turn 结束必须释放已取得资源。
- 插件 tools 默认由 AI SDK 原生 `tool_search` 渐进披露，并以
  `mcp__<server>__<tool>` 命名。当前 `knowledge@platform` 只有 `knowledge_search`，
  `canvas@platform` 只有只读 `get_canvas`；不存在 Runtime 固定 client、旧写 Canvas tools 或 alias。
- Skills 渐进披露：初始 instructions 只有 name/description，命中后由 `load_skill` 读取已发布
  asset revision 并校验 digest。MCP inventory/schema 必须与 immutable release 一致，漂移 fail closed。

## Persistence boundaries

- PostgreSQL Session/message/run/input journal：业务会话、Turn 和 delivery authority。
- PostgreSQL `turn_plugin_snapshots`：Turn-frozen manifest/activation audit，不含 header、token 或 grant。
- Redis UIMessage SSE：活跃 run 的有界 transport replay，不是会话历史。
- Workflow World：durable business Job 的 execution resume，不恢复交互 ToolLoop 进程栈。
- provider response cursor：可丢弃的推理优化，不是上述任何一种持久化。

浏览器断开只移除 subscriber；显式 Stop 才取消 run。finalizer 必须先释放/持久化 sandbox，
再提交 terminal journal 和释放 session lease；清理失败不能丢失已生成内容或伪装为 completed。

架构事实见 [Agent runtime ADR](../../../../../../docs/ADR/agent-runtime.md) 与
[Agent plugin ADR](../../../../../../docs/ADR/agent-plugins.md)。
