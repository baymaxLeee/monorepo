# Runtime Agent

本目录以 AI SDK 7 `Agent` interface 为稳定边界。runtime-server 只有一个通用主 Agent；
Run 直接创建唯一的 ToolLoop 实现，不经过 Agent factory、profile 或 runtime 选择层。

```text
agent/
├── agents/          # 唯一 ToolLoop 实现及其运行输入类型
├── context/         # UIMessage → bounded ModelMessage、instructions、compaction
├── tools/           # 薄 tool adapters；files 统一读写与 artifact 能力
├── integrations/    # MCP、Skills 等 instructions/tools 扩展
├── runs/            # run 编排、lease/cancel、trace persistence
├── streams/         # Redis-backed UIMessage SSE transport resume
├── memory/          # durable memory 与 extraction
└── observability/   # product run/step/tool lifecycle
```

## Runtime policy

- `ToolLoopAgent` 是唯一的交互 runtime（Brain），不得新增 Agent factory 或 profile 选择层。
- 必须跨进程、部署、重试或长期等待后恢复的工作交给 Runtime worker Workflow。当前 Runtime 工具只把视频制片等已声明的耐久业务任务交给 worker；普通文件始终由主 Agent 在 run sandbox 中生成并通过一次 `upload_artifacts` 批量发布。视频创建工具在初始规划持久化后返回，后续审批/生成仍由 Workflow 执行。当前分工见 `docs/ADR/durable-execution.md`，不从旧任务计划推断返回边界。
- Runtime 和 Desktop 直接使用共享公共工具集合，再追加各自真实宿主/领域 manifests；重名拒绝启动，
  不通过 profile 裁剪或替换工具。

## Context and tools

- `prepareStep` 只合并 continuation/steering/workspace facts，并在硬 step 上限或工具已确认的终态错误后关闭工具以生成 truthful summary；不回扫历史做失败计数，不选择恢复工具，也不维护 Plan、HTML verification 或 exact-tool 状态机。显式 Plan `file_id` 由 projector 和 sandbox import 解析，完整读取要求属于 runtime contract。
- 每个 tool 通过自己的 `contextSchema` 获得最小权限数据，不共享万能 ToolContext。
- 内置 function tool 的 Zod Schema 是唯一输入契约：字段说明、strict calling 和 compact `inputExamples` 随 tool definition 发送，不在 instructions 复制 payload。 `repairToolCall` 只记录 Schema 前的拒绝并返回 `null`；主 Agent 在下一 step 自行决定是否修正，runtime 不调用隐藏 repair model。
- `tools/` 只放模型调用边界；artifact、memory、plan 的业务实现属于各自 subsystem。
- `ToolCatalog` 是可实例化对象。默认 catalog 只作为应用 composition root，禁止模块级数组泄漏租户状态。
- 新 run 的 context projection 将历史 `upload_artifacts` 批量结果与媒体工具结果压缩为稳定 file/document id、ETag、task id 和失败事实；不把大正文、旧命令或无效 Schema 调用重新示范给模型。持久化 UIMessage 不变。
- Skills 可以贡献 instructions 和 tools；MCP 必须显式筛选工具/schema，不能直接暴露远端全集。
- Skill 采用渐进披露：初始 prompt 只含 name/description，命中后由 `load_skill` 从 Admin 读取已发布快照的 `SKILL.md`。纯工作流、证据规则和输出模板属于 Skill，不为此新增垂直业务 tool。
- Subagent 通过 tool delegation 运行独立 context，并将压缩后的 `toModelOutput` 返回主模型。

## Persistence boundaries

- Thread/message persistence：恢复业务会话。
- Redis UIMessage SSE：浏览器刷新、断网和切换会话后的 transport resume。
- Workflow/Harness session：进程崩溃、部署或长期等待后的 execution resume。

三者不能混为一种“断点续传”。浏览器断开只移除 subscriber；只有显式 cancel 才终止 run。
