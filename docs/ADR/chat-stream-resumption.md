# 当前决策：Chat 活跃流恢复与 Redis 容量边界

状态：当前。本文拥有 Chat 原生 UIMessage SSE 在 Redis 中的生命周期、容量与故障语义；
消息协议本身归 [Chat UI 协议](chat-ui-protocol.md)，Agent 执行归
[Agent runtime](agent-runtime.md)。

## 决策

PostgreSQL journal 是 assistant UIMessage、tool 终态、run 状态和 usage 的长期权威。
Redis 不是消息历史，也不是任务队列；它只保存 active run 的原生 SSE replay buffer，
供 `DefaultChatTransport` 在断网、刷新或切回页面后从头完整重放。

每个 active buffer 当前使用以下边界：

- active pointer 与 stream 使用五分钟滑动租约；独立 heartbeat 每 60 秒续租，不能依赖模型持续输出；
- public SSE 仍直接流向浏览器；独立 Redis persistence consumer 将连续原始 chunks 最多聚合 25 ms 或 32 KiB 后再写入，不增加用户侧输出延迟超过该窗口；
- 单个 Redis fragment 不超过 64 KiB；单 run 最多 8 MiB、10,000 entries；
- append 在一个 Redis Lua 操作中校验 run 身份和累计 bytes/entries，再写 stream、更新计数并续租；
- entry 统计的是聚合后为 Redis 存储切出的 fragments，不是 provider delta、UIMessage chunk 或 Agent model step；`XADD MAXLEN ~` 只作为最后保险，应用字节预算才是主要容量控制；
- 超过预算会以带 `reason`、累计 bytes/entries 和上限的 `AgentStreamCapacityError` 中止生成并按 failed run 收口，不能裁掉头部后继续声称支持完整 replay；
- PostgreSQL finalizer 提交且 SSE consumer 排空后，立即 compare-delete active pointer，并删除该 run 的 stream；
- failed、cancelled、启动异常和 orphan/interrupted 使用相同清理路径；TTL 只回收清理进程本身消失后留下的 key。

Redis key 仍为：

- `chat:agent-streams:<conversationId>:active`：当前 run id、开始时间、累计 bytes/entries；
- `chat:agent-streams:<runId>:sse`：可从头重放的原生 SSE fragments。

旧 run 清理只能在 pointer 仍指向自己时删除 conversation active key，但 run stream 以唯一 run id
命名，可以直接删除；迟到清理不得影响新 run。

## 为什么不能只依赖 TTL 或 MAXLEN

一小时 TTL 曾让三个异常 stream 在本地累计约 1.1、1.5 和 2.6 GiB。缩短 TTL 只能减少进程
崩溃后的尸体时间；持续写入的 runaway stream 会不断续租，仍能在完成前耗尽 Redis。

`MAXLEN` 只限制 entry 数，不限制单 entry 字节数。直接把每个 provider/UIMessage delta 写成一个 entry
还会让正常的长 ReAct run 在实际数据很小时先撞 entry 上限；因此写 Redis 前必须做有界低延迟聚合。
更重要的是，当前 AI SDK resume 使用完整重放：
静默裁掉 `start`、text/tool 起始 chunks 会生成协议上不完整的 response。因此容量保护必须在写入前
按 bytes 和 entries 拒绝，并把 run 明确收口，而不是返回损坏 replay。

这里使用 `XREAD BLOCK` 和每个 subscriber 独立 cursor；不使用 consumer group、ACK 或 pending
entries，因为浏览器恢复是广播/重放，不是竞争消费的工作队列。Redis Stream ID 只作为服务端 cursor，
当前不另造基于 `Last-Event-ID` 的增量协议。

## 高频工具进度

所有进入 public UIMessage stream 的 preliminary tool result 都必须是有界快照。特别是 `subagents`：
child 的完整 UIMessage 仅在进程内累计，preliminary result 只携带当前 tool states 和最多 4,096
字符的最新文本；文本每增长 1,024 字符或 tool state 改变才形成候选更新，每个 child 最多发布 64
次。terminal result 才携带完整 message、report、usage 或结构化失败。

这保留 AI SDK 官方 preliminary/final tool part 语义和现有 Subagent UI，同时避免“第 N 个 delta 再发送
前 N 个 delta”的 O(n²) SSE、structured clone 和 Redis 字节增长。其他累计 snapshot 工具出现同类
增长时也必须在 producer 边界压缩，不能指望 Redis trimming 修复上游载荷。

## 生命周期与故障语义

```text
claim run
  -> activate Redis pointer with zero counters
  -> stream native SSE to the browser while coalescing bounded Redis writes
  -> PostgreSQL finalizer commits terminal journal
  -> SSE consumer drains finish / [DONE]
  -> compare-delete pointer + delete run stream
```

浏览器断开只终止自己的 blocking reader，服务端 consumer 继续驱动生成、journal finalization 和清理。
Redis 普通写入暂时失败时，已连接的响应和 PostgreSQL finalization仍可继续，但该 run 可能失去恢复能力；
错误必须观测，短租约会回收残留 pointer。容量超限不同：它表示确定的本地资源边界，必须中止 run，
不能继续制造无法恢复的输出。

进程在终态提交前消失时，Redis key 最多保留一个租约窗口；数据库 lease/orphan reconciler 最终把 run
解释为 interrupted。进程在数据库提交后、Redis 删除前消失时，同样由短 TTL 回收，历史立即从
PostgreSQL 读取，不依赖完成后的 Redis replay。

## 取舍与剩余运维边界

该设计选择简单的完整字节重放；25 ms / 32 KiB 聚合只改变 Redis entry 边界，不解析、重写或合成
UIMessage 事件，也不引入 checkpoint snapshot + rolling delta 协议。代价是每个 active
run 需要保存完整 wire log，因此必须有硬上限；超过上限的极端输出会失败，而不是无限恢复。

单 run 上限不能替代 Redis 实例的总容量规划。最坏 replay 内存近似为“active run 并发数 × 8 MiB”再加
Redis 数据结构和碎片开销；部署必须配置 used memory、evictions、active stream bytes、overflow 和 cleanup
failure 告警，并为共享 Redis 留出余量。若实际并发接近实例预算，应增加分布式 admission 或把 replay
buffer 隔离到专用 Redis，而不是继续提高单 run 上限。

## 实现与验证

- [stream service](../../apps/backend/services/chat/src/application/agent/streams/service.ts)：租约、原子预算、完整重放与清理；
- [run owner](../../apps/backend/services/chat/src/application/agent/runs/run.ts)：容量超限传播和 journal finalizer；
- [run lease](../../apps/backend/services/chat/src/application/agent/runs/lease.ts)：run AbortSignal 与 orphan 清理；
- [subagents](../../apps/backend/services/chat/src/application/agent/tools/builtins/subagents.ts)：有界 preliminary progress；
- [Redis integration tests](../../apps/backend/services/chat/src/application/agent/streams/service.integration.test.ts)：短 TTL、active replay、终态删除、容量超限和 compare-delete；
- [Subagent tests](../../apps/backend/services/chat/src/application/agent/tools/builtins/subagents.test.ts)：并行、失败、取消、完整终态与 progress 上界。

变更这些边界时运行 `just test backend/chat`、启用 `CHAT_REDIS_INTEGRATION=1` 的 stream integration、
`just test frontend/@repo/chat`，并执行 Chat backend lint/typecheck。容量值变化还必须复核正常 run 的
P95/P99 bytes、active 并发和 Redis 总内存预算，不能只让单元测试通过。
