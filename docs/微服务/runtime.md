# Runtime

Runtime 是 Web Chat、Desktop、Canvas 等宿主共用的 Agent 执行内核，也是 messages、run journal、工具、Sandbox 与 detached durable Job 的唯一 owner。完整边界见 [Runtime ADR](../ADR/session-runtime.md)。

一个 Runtime image 提供三个角色：

- `runtime-server`（8015）：Hono、`/v1/sessions`、messages、AI SDK `ToolLoopAgent` 与普通工具；
- `runtime-worker`（8011）：Nitro + Workflow durable Job；
- `runtime-sandbox`（8014）：Docker/Kubernetes Sandbox controller，独立权限运行。

Chat 只持有 Web 产品 conversation 元数据与 Runtime Session 映射。Runtime 业务数据使用 PostgreSQL `runtime`；Workflow World 使用独立的 `workflow` database 和官方迁移，不作为业务查询接口。

本地命令：`pnpm dev:server`、`pnpm dev:worker`、`pnpm dev:sandbox`。验证：`just test backend/runtime`、`just build runtime`、`just check-repo`。
