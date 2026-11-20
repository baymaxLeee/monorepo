# Runtime

共享 TypeScript 内核定义交互 Turn、运行中输入、执行权限与插件生命周期。云 Runtime 服务持有云端 Session、run journal、沙箱租约和独立 durable Job。Electron utility process 用同一个内核运行本地 Turn，以 SQLite 和用户绑定的工作区保存本地事实。见 [内核与宿主](../ADR/agent-runtime.md) 和 [云 Session](../ADR/session-runtime.md)。

一个 Runtime image 提供三个角色：

- `runtime-server`（8015）：Hono、`/v1/sessions`、messages、AI SDK `ToolLoopAgent` 与普通工具；
- `runtime-worker`（8011）：Nitro + Workflow durable Job；
- `runtime-sandbox`（8014）：Docker/Kubernetes Sandbox controller，独立权限运行。

Chat 只持有 Web 产品 conversation 元数据与 Runtime Session 映射。Runtime 业务数据使用 PostgreSQL `runtime`；Workflow World 使用独立的 `workflow` database 和官方迁移，不作为业务查询接口。

Runtime 自有 Media/Memory tools；Knowledge、Canvas 与外部 MCP 都由 Admin workspace installation
在 Turn 开始时解析，不由 server composition root 固定绑定。Chat/renderer 只传稳定 `pluginId` 和
非秘密 bindings；Runtime 先保存去密 snapshot，再由 shared plugin manager 懒连接并在结束、失败或
取消时释放资源。当前 `knowledge@platform` 只有 `knowledge_search`，`canvas@platform` 只有只读
`get_canvas`，不提供节点更新、生成或故事板提交。完整边界见
[Agent plugin ADR](../ADR/agent-plugins.md)。

本地命令：`pnpm dev:server`、`pnpm dev:worker`、`pnpm dev:sandbox`。验证：`just test backend/runtime`、`just build runtime`、`just check-repo`。
