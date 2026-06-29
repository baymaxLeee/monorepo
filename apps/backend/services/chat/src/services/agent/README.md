# Chat Agent 模块

本目录采用 AI SDK `ToolLoopAgent` 与 Eve 的 filesystem-first 形状：agent 定义、能力、
instructions、执行协议、上下文、持久化和观测分别拥有明确入口。它不是 Eve 应用，也不恢复
WorkflowAgent；每条用户消息仍创建一个独立 run。

```text
agent/
├── agent.ts                 # ToolLoopAgent 定义与 lifecycle hooks
├── contract.ts              # run/capability 共享契约
├── config.ts                # 有产品依据的运行参数
├── capabilities/            # agent 能做什么
│   ├── registry.ts          # built-in + run-scoped extension 装配
│   ├── knowledge/           # conversation documents / knowledge tools
│   ├── artifacts/           # artifact tool definitions
│   ├── plans/               # plan tools 与 plan artifact service
│   ├── memory/ web/ interaction/
│   ├── mcp/                 # MCP capability 注册边界
│   └── skills/              # skill capability 注册边界
├── instructions/            # standing/mode/context instructions
├── context/                 # UIMessage → bounded ModelMessage projection
├── execution/               # HTTP run orchestration、lease、cancel、stream persistence
├── model/                   # provider/model adapter
├── observability/           # step/tool lifecycle trace
├── persistence/             # agent run、tool trace、memory repository
└── artifacts/               # generation、compiler、worker、browser runtime template
```

## 依赖方向

- `execution` 可以编排 agent、context、instructions 和 persistence；其他目录不得反向依赖
  `execution`。
- `agent.ts` 只定义模型循环，不读取 HTTP request、数据库消息或 Knowledge 文档。
- 每个 capability 自己拥有 schema、description 和 execute；禁止再建立集中式 `tools.ts`。
- `context` 决定模型看到什么；capability tool output 不得自行拼接到历史上下文。
- `observability` 只记录 lifecycle，失败不得影响用户生成。
- Artifact worker 是后台执行设施，不注册为主 agent 或子 agent。

## Skills 与 MCP 扩展

`registerSkillCapability` 和 `registerMcpCapability` 都接入异步 capability registry。Provider
按 run 创建工具或 instructions，并通过 `dispose` 释放连接。这样可以按用户、会话和模式选择
能力，而不把凭据或连接生命周期放进 `agent.ts`。

- Skills 默认只贡献按需 instructions；只有确有执行能力时才附带工具。
- MCP 在生产环境使用 HTTP transport，显式选择工具/schema；禁止无审核地暴露远端全量工具。
- 工具名冲突直接失败，不能静默覆盖 built-in capability。
- 外部文档、MCP resource 和 Knowledge 内容始终视为不可信上下文。
