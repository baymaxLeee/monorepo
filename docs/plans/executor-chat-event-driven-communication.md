# Executor ↔ Chat 事件驱动通信方案(NATS JetStream S2S pub/sub)

## 结论

- 借本次机会引入仓库**第一套通用 server-to-server pub/sub**:选 **NATS JetStream**
  (单二进制、Go/Python/TS 官方客户端齐、durable pull consumer + 显式 ack、VPS 单节点
  → K8s 三节点平滑)。[NATS](https://docs.nats.io/)、[JetStream Consumers](https://docs.nats.io/nats-concepts/jetstream/consumers)
- 通信分层:
  - Chat → Executor:继续 HTTP `POST /tasks` / cancel / snapshot。
  - Executor → Chat(及未来任意服务):JetStream 发布**状态跃迁**事件(终态 + 里程碑)。
  - Executor 内部:Workflow DevKit 负责长任务重试/恢复/取消。
  - Chat → 浏览器:继续唯一的 useChat UIMessage SSE,**不新增第二条浏览器流**(ADR-0035)。
- **可靠性是关键,且不靠"一次投递的时序"来保证**:总线是快路径,`GET /tasks/:id` 轮询
  降级为**对账/兜底真相源**。事件丢失或延迟时,waiter 退回一次轮询仍拿到终态。这是
  event-carried-state + reconcile 的工业标准形态。

```text
Chat ──HTTP POST /tasks──> Executor ──start()──> Workflow
  │                              │ 同一DB事务: task状态 + event_outbox
  │                              ▼ relay 发布(Nats-Msg-Id=event_id)
  │                        JetStream (events.executor.*)
  │              ┌───────────────┴───────────────┐
  │      durable projection consumer      per-replica ephemeral wake
  │      (inbox去重+revision单调→          (best-effort 唤醒本副本 waiter)
  │       chat task_projection)                   │
  │              └───────────────┬───────────────┘
  ▼                              ▼
唯一 UIMessage SSE  <──  waiter: race(唤醒, 退避轮询兜底) 读 projection/快照
```

## 1. 批判性复审(哪些成立、哪些要改)

已核对代码,非记忆:

- Chat 工具 `execute` 是**前台阻塞**的 async generator,跑在**持有该 run 的单个副本**
  内(run lease + Redis resumable stream),用 `pollTaskSnapshots`(`TASK_POLL_MS=1_500`)
  轮询 `GET /tasks/:id`。它同时承载:HTML 分块进度(`artifacts.ts`)、Video 终态进度、
  Video"规划完成"里程碑(`media.ts` 读 production stage)、以及 abort→`cancelTask`。
- 进度/终态都作为 preliminary `tool-*` results 骑唯一 UIMessage SSE(ADR-0035)。
- **系统当前无任何消息中间件**:`schemas/events/bot.published.v1.json` 只是 schema 占位,
  无后端 publisher/consumer;`docker-compose` 无 NATS/Kafka/Rabbit。本方案引入首个 broker。
- `docs/系统架构/overview.md` 现写"异步:CloudEvents 经消息总线(Kafka,生产)"——本方案
  改选 JetStream,**需同步更新该文档**(见 §8)。

| 现有设计 | 处置 |
|---|---|
| 唯一 useChat 浏览器流 | **保留**(不新增第二条浏览器流) |
| `GET /tasks/:id` 轮询 | **保留但降级**为对账/兜底真相源,不再是唯一路径 |
| Executor 无 outbound push(ADR-0035) | **有意反转**:改为经 JetStream 的 S2S 事件(见 §3 理由) |

**反转 ADR-0035 的理由(必须显式):** ADR-0035 删除的是"executor→chat HTTP notify +
第二条 task-progress SSE",动机是"两条浏览器流收敛成一条"。本方案**不恢复第二条浏览
器流**,只在**服务间**引入通用 pub/sub,并把它作为可复用基础设施(未来审计/计费/多
owner fan-out 的第一个真实消费者就是 Chat 的 task projection)。这是 ADR-0035 未覆盖
的新决策,不是回退它的浏览器侧结论。

**避免原稿的两个坑:**

1. **事件粒度分层(解决"进度 vs 终态"自相矛盾)**:总线**只**承载可靠性关键的**状态
   跃迁**——task 终态(`completed/failed/cancelled`)+ Video"规划完成"里程碑。细粒度
   `blocks_done/total`、`progress_done/total` 是 best-effort UI sugar,**继续走轮询**,
   不为每个 block/段落发持久事件(避免事件放大)。总线事件少而可靠,轮询多而廉价。
2. **不整体删除 `pollTaskSnapshots`**:它仍是兜底真相源与 abort→cancel 宿主。改动是
   在其 `abortableSleep` 期间同时 `await` 一个"唤醒 promise",并放宽轮询间隔(退避到
   3–5s),而不是删掉轮询。

## 2. 官方与 benchmark 对齐

- AI SDK `ToolLoopAgent` 的进度语义由**工具自身 async generator**(preliminary tool
  results,终态为最后一次 `yield`)承载,骑唯一 UIMessage stream——本方案不改这一层,
  总线只喂 waiter 决定何时产出下一个 `yield`。
- Workflow DevKit:`start()` 只入队即返回;任务业务真相在 Executor `tasks` 表,
  `GET /tasks/:id` 是官方读路径,故轮询天然适合做兜底真相源。
- benchmark(Cursor Background Agents / Codex / Claude Code):后台任务=可寻址状态,
  前台**轮询/重连**读取。本方案保留该可靠内核(轮询兜底),仅叠加 pub/sub 快路径,
  与 benchmark 一致而非相悖。[Cursor Background Agents](https://docs.cursor.com/background-agent)

## 3. 事件契约与 subject

- 在 `schemas/events/` 新增 CloudEvents 1.0 契约(沿用 `bot.published.v1.json` 约定,
  并在 `docs/微服务/events.md` 登记):
  - `executor.task.updated.v1`:`task_id`、`task_type`、`owner_service`、`owner_ref`、
    `revision`、`status`、终态 `result_ref/error`(只放持久化资源 ID,不放 bytes)。
  - `executor.video-production.updated.v1`:`production_id`、`task_id`、`owner_ref`、
    `version`、`stage`、`awaiting_action`(覆盖"规划完成"里程碑)。
- subject:`events.executor.task.updated.v1.<owner_service>`、
  `events.executor.video-production.updated.v1.<owner_service>`。
- CloudEvent 用 `id/source/type/subject/time/datacontenttype`,传播 `traceparent`;
  **不带** provider secret / 完整 HTML / 媒体 bytes,只传状态与持久化资源 ID。
- 第一阶段只落地 Chat/Executor 所需的 **TypeScript** publisher/consumer;未来 Go/Python
  服务直接用各自官方 NATS + CloudEvents SDK + 同一 JSON Schema,不预建跨语言自研框架。

## 4. Executor 实现(不丢事件)

- 新增 `event_outbox` 表(Executor 自己的 DB)。在写 task 状态/里程碑的**同一 DB 事务**
  内插入 outbox 行(`tasks/notify.ts` 已用 `getDb().transaction`)。杜绝"DB 已完成但事
  件没发"的双写断层。[Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- 独立 relay 循环读未发布行 → `publish` 到 JetStream,`Nats-Msg-Id=event_id`(JetStream
  消息去重窗口),成功后标记 published。relay 是**普通 Node 背景循环**(在 `src/index.ts`
  模块作用域启动,类似现有 `getWorld().start()`)。
- **构建约束(Nitro/WDK gotcha #6)**:NATS 客户端是 Node 依赖,**只能**从普通 Node 代码
  (relay / `"use step"` 体)导入,**绝不能**被 `"use workflow"` orchestrator 传递依赖,
  否则 `nitro build` 的 directive 发现会失败。outbox 写在 step 内,发布在 relay 内。
- 发布时机:仅**状态跃迁**(终态 + 视频规划里程碑),不为每次 progress 递增发事件。

## 5. Chat 实现(至少一次 + 幂等 + 兜底)

- **durable projection consumer**(可复用的 S2S 消费者,也是未来服务的模板):durable
  pull consumer 消费上述 subject,`event_inbox` 按 CloudEvent `id` 去重,`task_projection`
  只接受更大的 `revision/version`(终态不被旧事件回退),**本地事务提交后才 ack**;永久
  schema 错误进 DLQ,临时错误重投。at-least-once,不宣称 exactly-once。[Redis Pub/Sub 为何不用](https://redis.io/docs/latest/develop/pubsub/)(at-most-once,断线即丢)
- **waiter 唤醒(低延迟,best-effort)**:每副本另跑一个**ephemeral** subscriber,收到事
  件即唤醒本副本上以 `owner_ref=toolCallId` 注册的 waiter。它**不写库、可丢**——因为
  正确性由 projection + 轮询兜底保证,所以无需跨副本 fanout、无需"唤醒所有副本"逻辑。
- **waiter 兜底**:`pollTaskSnapshots` 在 sleep 期间 `race(唤醒promise, 退避轮询)`;唤醒
  只是提前结束 sleep 并立刻读一次 projection/快照。事件丢失/副本重启 → 退避轮询照样收敛。
- **注册时序**:waiter 在 HTTP 派发**前**注册,避免极快任务先完成的竞态。
- **取消/重启不回归**:abort→`cancelTask` 仍在 `pollTaskSnapshots` 内;Chat 重启后结果
  可从 projection/UI 恢复,已中断的 ToolLoopAgent run 标记 interrupted,不自动重建。

## 6. 部署与迁移

- VPS:`docker-compose` 增加单节点、file-backed JetStream + 独立持久卷,仅暴露 Docker
  内网;明确它抗进程重启、不抗整机/磁盘故障。
- K8s:三节点 JetStream、R3 stream/consumer、本地 SSD、服务级 subject ACL(官方建议 HA
  用 3 或 5 节点)。[JetStream 集群](https://docs.nats.io/running-a-nats-service/configuration/clustering/jetstream_clustering)
- **更新 `docs/系统架构/overview.md`**:异步总线由"Kafka(生产)"改为"NATS JetStream",
  并注明选型理由(轻量、多语言、VPS→K8s 平滑;Kafka 留作未来高吞吐事件日志的再评估项)。
- 更新 ADR-0035:保留"单一 UIMessage 浏览器流",新增"服务间经 JetStream 的状态事件 +
  轮询降级为对账兜底"的决策;新增 `docs/ADR/00NN-executor-chat-s2s-pubsub.md` 记录
  outbox/inbox/revision 单调/poll-reconcile/事件粒度分层。同步 executor 与 chat `AGENTS.md`
  中"无 outbound push"的描述。
- retention/磁盘上限由实际事件大小、Executor 峰值与部署磁盘预算推导,不加面向业务的
  任意超时/容量配置。

## 7. 验证

- HTML/Video:终态与里程碑经事件**更快**到达并结束 waiter;轮询退避后周期性 GET 明显
  减少但仍存在(兜底,不宣称"零 GET")。
- Executor 在 DB commit 后、publish 前崩溃:重启后 outbox 补发。
- JetStream 不可用:Executor 正常完成并积压 outbox;waiter 经轮询兜底拿到终态;总线恢
  复后补发,inbox 去重。
- 重复/乱序事件:inbox 去重,projection 按 revision 不回退。
- 两副本:事件到达非持有 waiter 的副本时,projection 仍被更新;持有 waiter 的副本经
  ephemeral 唤醒或轮询兜底收敛;不需要跨副本信号。
- Stop:仍取消 Executor task、Workflow 与任务类型补偿。
- 命令:`cd apps/backend && just lint chat && just lint executor && just build chat &&
  just build executor`;回根 `just sync`(若改 OpenAPI/transport)、`just lint`、`just build`;
  VPS compose smoke + K8s manifest render。按 demo-phase 不新增测试文件/脚手架。

## 8. 与 `chat-owned-generation-planning.md` 的关系

两方案都碰 `POST /tasks` 与 transport。那个方案把 request body 改成按 `type` 判别的联合;
本方案新增的是**出站事件契约**(`schemas/events/`),不改 `POST /tasks` 入站契约。建议
**先落地那个方案的 discriminated payload,再落地本方案的事件层**,避免对同一 transport
面并发冲突改写;事件 `data` 里的 `task_type` 直接复用那个方案定稿的类型枚举。

## 实施顺序

- [ ] `schemas/events/` 定义两个 CloudEvents 契约 + `docs/微服务/events.md` 登记。
- [ ] VPS `docker-compose` + K8s manifest 加 JetStream;`overview.md` 选型改 NATS。
- [ ] Executor:`event_outbox` 表 + 事务内写入 + relay 发布(注意 WDK 导入边界)。
- [ ] Chat:durable projection consumer + `event_inbox` + `task_projection`(revision 单调)。
- [ ] Chat:ephemeral waiter 唤醒 + `pollTaskSnapshots` 改 `race(唤醒, 退避轮询)`。
- [ ] ADR/`AGENTS.md`/`overview.md` 文档更新;tracing 区分 `publish`/`consume` span。
- [ ] scoped lint/build、`just sync`、根构建、implementation review。
