# Runtime Agent Host

本目录是 Backend 对共享 `@repo/agent-runtime` kernel 的宿主实现。Session、run、journal、
lease、stream finalizer、云端 sandbox 和领域能力属于 Runtime；`RuntimeTurn`、AI SDK loop、
run-input queue、context projection/compaction 和 tool execution scheduling 属于 shared package。

```text
agent/
├── runtime/        # CloudTurn capability/model/tool/environment 组装
├── context/        # PostgreSQL checkpoint、文件授权投影、instructions 输入
├── adapters/       # Runtime Sandbox、Web Search 与云端 execution host
├── tools/          # Canvas/Knowledge/Media/Memory 等 Runtime 领域 manifests
├── integrations/   # MCP 等外部 capability adapters
├── runs/           # admission、lease、cancel、journal finalizer 与 run-input delivery
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

## Context and tools

- PostgreSQL UIMessage journal 是会话事实源；provider response cursor 仅在 provider/model 与
  journal lineage 都匹配且未到水位时用于增量调用。否则从 journal 重建。
- `context/model-context.ts` 只实现数据库 checkpoint CAS 与受权文件转换。budget、recent-tail、
  compaction state 和 fail-closed checkpoint 安装属于 shared context manager。
- `prepareStep` 只处理 provider stored continuation、workspace runtime facts 和观测；任何 override
  都必须保留 shared input queue 提供的 steering message。
- 每个 tool 通过自己的 `contextSchema` 获得最小权限数据。schema/description/planning metadata
  是工具局部契约；不要在 system prompt 重建工具 router 或 payload 文档。
- ToolCatalog 是可实例化 composition object。Canvas、Media、Knowledge、Memory 等领域实现留在
  Runtime；shared package 不导入领域 client。
- Skills 渐进披露：初始 instructions 只有 name/description，命中后由 `load_skill` 读取已发布
  snapshot。MCP 必须显式筛选工具/schema，不能暴露远端全集。

## Persistence boundaries

- PostgreSQL Session/message/run/input journal：业务会话、Turn 和 delivery authority。
- Redis UIMessage SSE：活跃 run 的有界 transport replay，不是会话历史。
- Workflow World：durable business Job 的 execution resume，不恢复交互 ToolLoop 进程栈。
- provider response cursor：可丢弃的推理优化，不是上述任何一种持久化。

浏览器断开只移除 subscriber；显式 Stop 才取消 run。finalizer 必须先释放/持久化 sandbox，
再提交 terminal journal 和释放 session lease；清理失败不能丢失已生成内容或伪装为 completed。

架构事实见 [Agent runtime ADR](../../../../../../docs/ADR/agent-runtime.md) 与
[Session runtime ADR](../../../../../../docs/ADR/session-runtime.md)。
