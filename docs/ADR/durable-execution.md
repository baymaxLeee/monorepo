# 当前决策：耐久任务与视频工作流

状态：当前。Executor 执行可恢复任务，Chat 保持交互意图与生成规划。

## 执行边界

Executor 使用 Workflow 5 和自建 Postgres World。业务 task/projection 在服务库，
step、重放和执行事件在独立 Workflow 库；调用者不读取这两个库。启动先完成
数据库/World 初始化，再恢复运行任务、清理任务和待处理审批。

`POST /tasks` 按 owner identity 幂等启动；task read 提供快照，cancel 请求持久化
取消并执行 task 类型自己的补偿。`GET /tasks/:id/stream` 是内部鉴权 SSE：
连接先返回当前快照，Workflow durable stream 仅作唤醒信号，route 重读业务表。
run completion 与进度 stream 独立收口，stream EOF 不能推断业务成功。

消费者中断后重连同一 SSE，不增加 task-wait polling fallback，不回调 Chat，
不新增浏览器进度协议或通用消息 broker。业务真相保留在各服务自己的表。

注册种类以[registry](../../apps/backend/services/executor/src/application/tasks/registry.ts)
为准，当前仅包括图片生成和视频生成。Canvas 的生成、删除、归档、
视频拆帧和其他定制异步任务由 Canvas Worker 从 Canvas 数据库领取；Executor
不注册 Canvas task type，也不回调 Canvas worker HTTP 路由。Knowledge 文档转换与
索引在 Knowledge 请求内同步完成，不经过 Executor。

## 工作流与外部副作用

`use workflow` orchestrator 只处理可重放数据与流程，Node I/O、provider 调用及
跨服务请求放入 `use step`，防止依赖进入 Workflow sandbox。开发路径先做一次
Workflow 编译再由 Hono/tsx 托管；生产由 Nitro 构建。两者使用 Workflow 5 的
合并 flow handler 和 webhook，不能重新增加旧 step handler。

`run.cancel()` 使执行态终止，但不能自动撤销 provider 的付费任务。外部任务 ID
必须持久化，长调用观察取消，task type 注册补偿；取消先落库，再清理，清理失败
不复活任务。`WorkflowRunCancelledError` 与普通失败区别处理。

## 媒体生成业务

Chat 的图片和视频工具只负责提交 durable task；`POST /tasks` 返回后 tool execution
立即完成，不订阅任务 SSE、不等待 provider、分镜、审批或最终媒体。这里的“工具完成”
表示 Executor 已受理，不表示生成成功。任务状态与结果由 Executor API 和业务工作台
独立读取；用户停止当前 Chat run 不取消已经受理的后台任务。

图片批次由 Executor Workflow 串行调用 provider，并将成功结果写入 Storage/Knowledge。
付费图片调用不自动重试，避免在响应丢失时重复扣费；批次进度与最终结果写入 task。

Chat 提交完整创作规划；Executor 管理分镜/预算投影、审批、付费生成、Take 审核、
合成、确定性 QA、暂存与发布。审批绑定投影版本，修改使旧审批失效，Workflow
Hook 恢复同一耐久 run。创建工具在任务受理后立即返回稳定的 task/production ID，
不等待初始规划或完整视频生命周期，因此 Agent tool-loop 可以继续。

付费 create 不自动重试：响应丢失可能意味着 provider 已创建任务。记录 reservation
与 provider 标识，只有有幂等/查询契约时才安全恢复。确定性 QA 不等于语义质量
判断；需人工判断的发布要求保留业务审批。视频输入/输出流式处理并使用临时文件，
持久 bytes 进入 Asset，业务投影引用 revision。

## 取舍与验证

复用 Workflow 持久执行避免第二套 worker/lease 调度器；业务幂等、授权、付费
边界和补偿仍由服务负责。程序挂掉与用户显式 Stop 对任务的影响不同。

入口：[task routes](../../apps/backend/services/executor/src/api/http/routes/tasks.ts)、
[service](../../apps/backend/services/executor/src/application/tasks/service.ts)、
[bootstrap](../../apps/backend/services/executor/src/bootstrap/runtime.ts)、
[workflows](../../apps/backend/services/executor/workflows)。
验证：`just test backend/executor`、受影响调用者测试和 Executor build；持久恢复、
重复通知、取消补偿与审批恢复需真实 Workflow/数据库集成证据。
