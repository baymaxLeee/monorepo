# 当前决策：Runtime durable Job 与视频工作流

状态：当前。Runtime worker 执行可恢复 Job；Runtime server 的交互 `ToolLoopAgent` 不进入 Workflow。

## 执行边界

`runtime-worker` 使用 Workflow 5 和自管理 Postgres World。它不是独立子项目：HTTP、task/video application、domain 与 persistence 都在 Runtime 顶层四层结构中，只有启动和 Nitro 装配位于 `src/cmd/worker`。task/video projection 在 Runtime 业务库，step、replay 与引擎事件在独立 `workflow` database。Runtime server 只能通过 role transport 使用 worker API，不能读取 World 表。

`POST /tasks` 按 `owner_service=runtime + owner_ref` 幂等受理，并将该 owner 同时绑定 task type 与规范化 payload；同 owner 异参失败。task read 返回业务快照，cancel 先持久化再执行 task 类型补偿。`GET /tasks/:id/stream` 是 Runtime 内部 SSE：连接先返回当前快照，durable stream 仅作唤醒，route 重读业务表。stream EOF 不能推断业务成功。

当前 task registry 只包含图片和视频生成。Canvas 自有异步作业仍由 Canvas Worker 执行；Knowledge ingest 仍属于 Knowledge。统一 Agent Runtime 不等于接管所有服务的后台任务。

## Workflow 与外部副作用

`use workflow` orchestrator 只处理可重放控制流，Node I/O、provider 调用和跨服务请求放入 `use step`。生产与开发都使用 Nitro/Workflow 构建入口；不维护平行的自制 workflow host。

`run.cancel()` 不能自动撤销 provider 已产生的付费效果。外部 task ID 必须持久化，付费 create 默认不自动重试；只有远端幂等或可查询契约才能安全恢复。取消先落库，清理失败保留 cleanup responsibility，不复活任务。

task admission 与 Workflow `start()` 不是跨数据库事务。业务 task row 先作为持久 dispatch intent 落库；`start()` 超时或异常保持 queued，由周期 reconciler 重试。每个候选 run 在任何业务/付费副作用前通过 `claimTaskStep` 原子绑定 task，未取得 claim 的重复 run 失败并被取消。该模式允许多建无副作用的候选 run，不声称 World 与业务库 exactly-once；告警与积压监控必须覆盖长期 queued admission。

普通问答、Bash、artifact、workspace 保存和普通审批都由 runtime-server inline ToolLoop 执行。只有必须跨 Turn、进程、部署或长等待继续的 detached Job 才进入 Workflow。Worker 受理后返回稳定任务 ID。媒体工具通过该 ID 持续观察同一任务，直到发布 Session file 才结束工具调用。

## 媒体生成

Worker 的[图片工作流](../../apps/backend/services/runtime/workflows/image-generation.ts)与[视频工作流](../../apps/backend/services/runtime/workflows/video-generation.ts)将生成结果写入 Storage 并取得对应 revision 的 Claim。Runtime server 将结果登记为会话文件。一次视频调用返回一个文件，一次批量图片调用可返回多个文件；这条产品边界由[工具实现](../../apps/backend/services/runtime/src/application/agent/tools/builtins/media.ts)和[清单测试](../../apps/backend/services/runtime/src/application/agent/tools/builtins/media.test.ts)定义。

## 实现与验证

入口：[task routes](../../apps/backend/services/runtime/src/api/http/routes/tasks.ts)、[service](../../apps/backend/services/runtime/src/application/tasks/service.ts)、[worker bootstrap](../../apps/backend/services/runtime/src/bootstrap/worker-runtime.ts)、[production wrapper](../../apps/backend/services/runtime/src/cmd/worker/production.ts)、[Nitro app entry](../../apps/backend/services/runtime/src/cmd/worker/app.ts)、[local worker entry](../../apps/backend/services/runtime/src/cmd/worker/main.ts)、[workflows](../../apps/backend/services/runtime/workflows)。生产从同一 Runtime image 启动显式 wrapper，再加载 Nitro server；不得在 bundle 外导入第二份 bootstrap。worker 使用 application-managed shutdown，停止并等待 recovery loop、等待 `world.close()`，再关闭数据库；Nitro 在同一信号上停止 listener 并 drain 已接受的请求。不使用 `RUNTIME_ROLE`，也不恢复 `/runtime/worker` 子包。

验证至少运行 `just test backend/runtime` 与 `just build runtime`。持久恢复、重复 step、取消补偿和 World 数据库故障必须有真实 Workflow/PostgreSQL 证据；单元 mock 与类型检查不能证明 durable 语义。
