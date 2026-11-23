# Runtime

共享 TypeScript 内核定义交互 Turn、运行中输入、执行权限与插件生命周期。云 Runtime 服务持有云端 Session、run journal、沙箱租约和独立 durable Job。Electron utility process 用同一个内核运行本地 Turn，以 SQLite 和用户绑定的工作区保存本地事实。见 [内核与宿主](../ADR/agent-runtime.md) 和 [云 Session](../ADR/session-runtime.md)。

一个 Runtime image 提供三个角色：

- `runtime-server`（8015）：Hono、`/v1/sessions`、messages、AI SDK `ToolLoopAgent` 与普通工具；
- `runtime-worker`（8011）：Nitro + Workflow durable Job；
- `runtime-sandbox`（8014）：Docker/Kubernetes Sandbox controller，独立权限运行。

Chat 只持有 Web 产品 conversation 元数据与 Runtime Session 映射。Runtime 业务数据使用 PostgreSQL `runtime`；Workflow World 使用独立的 `workflow` database 和官方迁移，不作为业务查询接口。

当前 PostgreSQL journal 已将一个用户任务保持为唯一 logical `turns.id`；client-tool/approval continuation 将前 attempt 结算为 `waiting`，并追加 `turn_attempts.attempt_epoch`。`waiting/running/cancel_requested` 共用 one-active-Turn guard，step、tool effect、lease、Sandbox execution 与 workspace writer 都受精确 attempt fencing。execute wrapper 在进入 host code 前原子 claim `tool_effects`；其 `(turn_id, tool_call_id)` 身份和完整 canonical input digest 决定 replay，redacted input 只供观察，completed 可跨 attempt replay，重复 claim、异参或 unconfirmed 结果 fail closed。

shared recovery classifier 统一 `resume-next-step | resume-waiting | regenerate-model | reconcile-effect | interrupt` 五类判定。Cloud 每 attempt 持久化 immutable、无 secret 的 resume envelope；orphan reconciler 原子分类后只为 `resume-next-step`/`regenerate-model` 领取新 epoch，先清理旧 Sandbox，再重取 provider/plugin authority、校验 history/instruction/catalog/workspace/compactor/remote generation 并进入同一个 AI SDK loop。waiting 保持稳定；取消、缺 envelope、unconfirmed effect、或 committed effect 没有 journaled SDK step 都中断。Desktop restart 仍 fail closed。绿地建模不保留旧 API/旧表双轨；一份 fresh-install `v1.0.0.0` 直接定义当前模型，local/VPS 的旧 Runtime 库由显式 reset 重建。详见 [交互恢复](../ADR/session-runtime.md#messages-查询与交互恢复) 和 [greenfield schema](../ADR/session-runtime.md#runtime-server-数据库采用绿地建模)。

Bash 继续只暴露一个工具和有界读取窗口；实际截断时附带 host-owned 完整日志路径，由模型用同一 Bash 按 byte offset/limit 读取。Cloud 日志位于独立 `/run/output` mount，随 Turn Sandbox 回收且不进入 workspace snapshot；Desktop 日志位于 Thread attachment root，随 Thread 删除。两端写入失败都不会发布不完整引用。

Runtime 自有 Media/Memory tools；Knowledge、Canvas 与外部 MCP 都由 Admin workspace installation
在 Turn 开始时解析，不由 server composition root 固定绑定。Chat/renderer 只传稳定 `pluginId` 和
非秘密 bindings；Runtime 先保存去密 snapshot，再由 shared plugin manager 懒连接并在结束、失败或
取消时释放资源。当前 `knowledge@platform` 只有 `knowledge_search`，`canvas@platform` 只有只读
`get_canvas_context`，不提供节点更新、生成或故事板提交。完整边界见
[Agent plugin ADR](../ADR/agent-plugins.md)。

本地命令：`pnpm dev:server`、`pnpm dev:worker`、`pnpm dev:sandbox`。验证：`just test backend/runtime`、`just build runtime`、`just check-repo`。
