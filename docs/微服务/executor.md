# Executor

Executor 是 TypeScript/Hono/Nitro 服务，使用 Workflow 5 + Postgres World 执行耐久任务。
Chat 负责交互意图与创作规划，Executor 负责任务、执行投影、重放、审批和补偿。

## 入口与任务

`POST /tasks` 按 owner identity 幂等启动，`GET /tasks/:id` 返回快照，
`GET /tasks/:id/stream` 提供鉴权后的内部状态 SSE，cancel 路由请求取消。
状态 stream 每次连接先返回当前快照，再用 Workflow durable stream 唤醒并重读
业务表；Chat 重连此 stream，不用额外 polling fallback 或浏览器第二条流。

当前 task type 以
[registry](../../apps/backend/services/executor/src/application/tasks/registry.ts)
为准：file-task-batch、knowledge-document-process、video-generation、
canvas-archive、canvas-video-frames。类型/schema 与 workflow 实现在同一注册点连接，
不要从旧计划恢复已删除任务。

视频制片通过 projection 和带版本的 decisions 管理审批；Workflow Hook 恢复原 run。
创建工具在初始分镜/预算持久化后返回 production ID，后续付费生成、Take 审核、
合成与发布在 Workflow 中继续。业务细节与取消边界见
[耐久执行决策](../ADR/durable-execution.md)。

## 运行与持久化

业务 task 在 Executor 数据库；执行态在 Workflow World。数据库初始化先于启动，
bootstrap 显式启动 World 并恢复未终态任务与补偿。跨服务 I/O 在 use step 中，
orchestrator 保持可重放且不依赖 Node 模块。

本地通过官方 builder 做一次 Workflow 编译后运行 Hono/tsx，不默认启用 watcher；
修改后重启。生产用 Nitro build。开发入口挂载合并 flow 和 webhook，没有旧
step handler。实际装配见 [dev.ts](../../apps/backend/services/executor/src/dev.ts)
与 [bootstrap](../../apps/backend/services/executor/src/bootstrap/runtime.ts)。

`run.cancel()` 不自动撤销付费 provider job；外部任务需要持久 ID、取消观察与
task-specific compensation。不能把 stream EOF 当业务完成或忽略清理失败。

开发命令：根 `just test backend/executor`、`just build executor`。
运行约束见 [Executor AGENTS](../../apps/backend/services/executor/AGENTS.md)。
