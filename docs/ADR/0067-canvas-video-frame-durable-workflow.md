# ADR 0067：视频首尾帧复用 Executor 持久工作流

状态：已接受
日期：2026-09-22

## 背景

Canvas 视频 Provider 成功后还需要把视频持久化为 Asset，并提取首尾帧供缩略图、历史记录和后续首尾帧生成使用。合并 AgentFrame 代码后，这一步同时保留了 `async_dispatches`、自研 MQ dispatcher、execution event consumer、worker runner 和 Executor Workflow 等多套抽象，但生产启动入口没有装配 MQ publisher、worker 或回调路由。结果是 Provider 已成功，本地任务却永久停留在 `running`。

首尾帧提取是确定性的长耗时媒体后处理，不需要新的消息协议或第二套调度状态机。仓库已经由 Executor 统一承载必须跨进程恢复的任务，并以 Workflow DevKit 的 workflow/step 作为唯一持久执行引擎。

## 决定

视频生成继续由 Canvas 本地 poll scheduler 管理；Provider 成功时，Canvas 在同一事务内持久化视频 Asset、创建内部首尾帧子任务，并写入现有 `async_dispatches` 作为 transactional outbox。该表在这条链路中只表达“尚未被 Executor 收敛”的 durable intent，不再承载一套独立 MQ 执行状态机。

Canvas 的 frame workflow reconciler 按子任务 ID 调用 Executor `canvas-video-frames` 任务。Executor 的 `owner_service + owner_ref` 唯一约束提供启动幂等；Workflow step 调用 Canvas 内部执行端点。Canvas 下载视频、运行 ffmpeg、按首帧和尾帧分别 checkpoint Artifact，并用数据库 CAS 创建 Asset、完成子任务和父任务。Workflow step 可能重复执行，因此每个 Canvas 操作都必须保持幂等。

成功时父视频任务从 `waiting_subtasks` 收敛为 `succeeded`；提帧最终失败时收敛为 `partial_success`，视频 Asset 仍可使用。Executor terminal 后删除 outbox 记录。Canvas 或 Executor 重启时，reconciler 使用相同 owner ref 重新连接同一个持久任务，不创建第二次业务执行。

首尾帧执行依赖改为视频服务构造函数的必填参数；禁止恢复可选 nil 注入。启动入口必须同时装配 frame service、父任务 terminal coordinator、Executor workflow reconciler 和内部执行路由。

## 依据

Workflow SDK 4.8.2 把 workflow 定义为可回放的确定性 orchestrator，把外部 I/O 放在 step；step 在崩溃或响应丢失时可能重试，因此外部副作用必须使用稳定幂等键。仓库本地文档依据为：

- `apps/backend/services/executor/node_modules/workflow/docs/how-it-works/understanding-directives.mdx`
- `apps/backend/services/executor/node_modules/workflow/docs/foundations/idempotency.mdx`
- `apps/backend/services/executor/AGENTS.md` 的 task registry、owner idempotency 和 boot recovery 约束

这也与成熟 durable execution 系统的通用模式一致：业务数据库保存权威状态，持久工作流保存执行事实；activity/step 采用至少一次执行假设和幂等提交。

## 被替代的方案

- **补齐自研 MQ dispatcher/consumer/runner**：拒绝。它复制 Executor 已有的恢复、重试、取消和可观测能力，并且当前仓库没有可运行的 publisher/consumer 基础设施。
- **在视频 poll goroutine 内同步运行 ffmpeg**：拒绝。长耗时处理会占用本地 scheduler lease，服务重启后缺少独立恢复边界。
- **视频成功后不提取帧**：拒绝。首帧是故事板缩略图和视频历史的正式输出，不能降级为仅前端临时行为。

## 验证要求

1. Provider 已成功但停留在 `running` 的任务在重启 Canvas/Executor 后能自动恢复。
2. 同一子任务重复 dispatch、Workflow step 重试和 Canvas 执行端点重试不得创建重复 Asset。
3. 成功路径最终清除 node generation slot、选择视频输出并写入首尾帧 Asset；失败路径保留视频并把父任务标为 `partial_success`。
4. Canvas、Executor 测试和构建通过；OpenAPI 重新生成并验证双方 transport client。
