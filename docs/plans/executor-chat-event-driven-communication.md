# Executor → Chat Workflow 原生任务状态流

## 结论

- 本阶段只解耦 Executor → Chat 的任务状态通知。Chat → Executor 的创建、查询、取消继续使用 HTTP。
- 不引入 Kafka、RabbitMQ、NATS、Redis Pub/Sub 或通用 CloudEvents 总线。
- 复用 Executor 已有 Workflow DevKit Postgres World 的持久流：
  - Workflow step 在业务状态提交后用 `getWritable()` 写轻量变化信号。
  - Executor 的内部 SSE route 用 `getRun(runId).getReadable()` 读取信号。
  - route 收到信号后重新读取 Executor 自己的 `tasks` / `video_productions`，向 Chat 输出权威快照。
- Chat 不再轮询任务；断流后重连同一 SSE，每次连接的首帧就是权威快照。
- Chat → 浏览器继续只有一条 AI SDK UIMessage SSE。任务进度仍作为官方 `tool-*` preliminary outputs。

## 依据

- 当前 `@workflow/world-postgres` 已用 Graphile Worker 提供可靠任务队列，并将 Workflow stream chunk
  持久化到 PostgreSQL；`getReadable()` 支持重放后继续追踪新 chunk。
- 本地 ClickHouse 最近 7 天记录到 199 次 `POST /tasks`、16,715 次 `GET /tasks/*` 和
  4,031 次 `GET /video-productions/*`。轮询尚不是性能瓶颈，但固定请求将通知节奏耦合到 Chat。
- Kafka 适合高吞吐、长期事件日志和多分区消费；RabbitMQ 适合复杂路由或命令队列；
  NATS JetStream 适合通用轻量 S2S 总线。当前只有一个明确消费者，新增 Broker 和 outbox/inbox
  会重复 Workflow 已有能力。
- Redis Pub/Sub 无缓冲；Redis Streams 虽可重放，但当前单 VPS Redis 使用内存上限、LRU 淘汰和
  异步持久化，不应成为任务正确性链路。

## 接口

- 新增内部接口：
  `GET /tasks/{id}/stream?owner_service=chat&owner_ref=<tool-call-id>`
- 沿用 `X-Internal-Token`、`X-Caller-Service` 和现有任务 owner 校验。
- 响应为 `text/event-stream`，每个 `snapshot` 事件的 `data` 是：

```ts
interface TaskWatchFrame {
  task: Task;
  production: VideoProductionProjection | null;
}
```

- 每次连接先发送当前快照；状态变化后发送新快照；任务终态发送最后一帧并关闭。
- `task.updatedAt` 与 `production.version` 是去重和防回退依据。

## 实现

1. 在 `schemas/streaming/` 登记状态流契约，并在 Executor OpenAPI 中声明 SSE route。
2. Executor：
   - 为 `reportProgressStep`、视频 planning/cost/stage step 写 Workflow 变化信号。
   - 关键视频信号使用独立、可重试的 Workflow step，重试不会重复业务写入。
   - stream route 先读业务快照，再从 Workflow stream 等待变化；收到信号后重新读取业务快照。
   - Workflow 终止时以 `run.returnValue` / task settlement 生成最终快照。
3. `transport-ts`：
   - 新增无普通 JSON 15 秒 deadline 的流式请求能力。
   - `ExecutorInternalClient.watchTask()` 解析 SSE 并返回 `AsyncGenerator<TaskWatchFrame>`。
4. Chat：
   - 将 `pollTaskSnapshots` 改为 stream-first watcher。
   - 流正常时只消费快照；连接异常或 EOF 时重连同一 SSE，不再调用任务 GET 轮询。
   - 保留 Abort → cancel、30 分钟等待上限和瞬时错误分类。
   - 视频 planning 完成直接读取 frame 中的 production，不再固定轮询 production route。
5. 更新 ADR-0035、Chat/Executor `AGENTS.md` 和系统架构总览，删除“Executor 无 streaming
   endpoint”和“生产已使用 Kafka”的失实描述。

## 验证

- 文件批任务：初始、进度、完成快照按序到达。
- 视频任务：成本和 storyboard approval projection 到达后 Chat 立即结束创建等待。
- 快速完成：订阅前已终态时首帧直接结束。
- 重复/重放：快照不回退。
- Chat/Executor 重启或 stream 断开：重连 SSE 并通过首帧权威快照收敛。
- Stop：仍取消 task、Workflow 和任务类型补偿。
- 任务等待链路不再出现固定 `GET /tasks/*` / `GET /video-productions/*`。
- Demo 阶段不新增测试文件。执行 `just gen-openapi executor`、`just sync`、scoped lint/build、
  根 `just lint` / `just build`，最后按 ADR-0016 做实现后复审。
