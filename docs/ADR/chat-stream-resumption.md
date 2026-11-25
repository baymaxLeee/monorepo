# 当前决策：Chat 活跃流恢复与持久 journal

状态：当前。本文拥有 Chat 原生 UIMessage SSE 的断线、后台消费与恢复语义；消息协议本身归 [Chat UI 协议](chat-ui-protocol.md)，Agent 执行归 [Agent runtime](agent-runtime.md)。

## 决策

PostgreSQL journal 是 assistant UIMessage、tool 终态、run 状态和 usage 的唯一恢复权威。Runtime 不再把 active run 的原始 SSE 复制到 Redis，也不存在按单会话 replay bytes/entries 终止 Turn 的容量规则。Redis 故障、淘汰或实例容量不能取消模型、Sandbox、tool 或 journal finalizer。

`POST /conversations/{id}/stream` 发起 Turn；`GET /conversations/{id}/stream` 恢复当前 active Turn。Runtime 的进程内 active stream hub 是唯一生产者 consumer：它持续消费 AI SDK `UIMessageChunk`，将 chunk 广播给零到多个 HTTP subscriber，并维护当前 assistant UIMessage 的可重放语义投影。浏览器断开只移除一个 subscriber，后台 consumer 仍驱动唯一 `ToolLoopAgent` 到终态并提交 journal。精确重复的已认领 POST 若该 Run 仍在本进程活动，直接订阅同一 hub，不创建第二个 loop。

active 投影不是累计 wire log：文本、reasoning 和 partial tool input delta 被合并，tool output、稳定 data id 与 message metadata 只保留当前语义状态，瞬时 data part 不进入 replay。投影严格复用 AI SDK 的归并语义：`message-metadata` 递归合并 object，数组和 primitive 替换；text/reasoning delta 保留最后一个非空 `providerMetadata`。索引随投影维护，逐 token 更新不扫描历史 chunk。GET 在同一个同步临界区内复制投影并登记 subscriber，因此一个 live chunk 必然位于 snapshot 或 subscription tail 之一。返回的是从 `start` 开始的完整 AI SDK replay，`DefaultChatTransport` 使用默认 replay reset 语义重建当前 assistant message，然后继续接收同一 Run 的 live chunks。

订阅者先读取初始快照，再按原序读取同一时刻登记的实时队列。队列沿用 Node 对象流默认高水位，积压超限时只中断该订阅，客户端可重新订阅。

## Codex 基线与有意适配

当前公开 Codex App Server 不用固定字节 replay log 决定 Turn 生死。运行中的 thread 由 `ThreadState.current_turn_history: ThreadHistoryBuilder` 保存 materialized active Turn/Item；resume 命令在该 thread listener 内读取 active snapshot、登记 connection，再继续发送同一 listener 的后续事件。冷历史来自 rollout/thread store。这个设计的核心是“语义快照与执行解耦、缓存不拥有执行权”，不是某个 Rust 模块或 wire 格式。

本仓库保持唯一 AI SDK loop 和官方 UIMessage transport。AI SDK `DefaultChatTransport` 的默认 replay 模式要求从 `start` 开始的完整 stream；裁掉头部后的 Redis tail 不是合法 replay。Runtime 因此把 Codex 的 active Turn/Item snapshot 适配成官方 UIMessage chunks 的 materialized projection，而不是引入自定义 cursor、客户端 merge 协议或第二套 tool/message 状态机。projection 只负责 live 连接交接，不参与执行准入、取消、finalization 或 cold recovery。

GET 的 `204` 必须由 header 区分状态。本地 hub 缺失但 PostgreSQL 仍有 running/cancel_requested Turn 时返回 `x-agent-run-state: active-detached` 和 `x-agent-run-id`；客户端只周期重试轻量 GET `/stream`，不周期读取完整会话。没有 running/cancel_requested Turn 时返回 `x-agent-run-state: idle`，客户端才一次性补读 PostgreSQL completed-step/terminal journal。orphan recovery 领取新 attempt 后建立新的 hub。live projection 的丢失只降低到 journal 恢复粒度，绝不能取消 Turn、伪造终态或阻塞 finalizer。当前公开 Codex 没有给出其云端跨节点 listener/保活内部实现，本仓库也不声称进程内 hub 已提供跨节点透明迁移。

精确重复 POST 在本进程有 hub 时订阅同一 Run；若 PostgreSQL 表明 Run active 但本进程没有 hub，则返回 `409 active_run_detached` 和同一组 run headers，客户端转入上述 GET resume 探针。已结束或等待客户端输入的 Turn 返回 `409 run_settled`，客户端读取 journal。它不能返回空的成功 SSE，因为空成功无法区分“仍在别处运行”和“已经结束”。

Codex 云端内部的 Redis、跨节点 listener 与保活实现没有公开源码；本文不把这些未知实现当作已验证事实。

## 生命周期与故障语义

```text
claim run
  -> register the attempt's in-process active stream hub
  -> consume native UIMessage chunks once and materialize active semantic state
  -> fan out to the POST subscriber; disconnect only removes that subscriber
  -> persist a materialized assistant message after each completed model step
  -> finalize PostgreSQL journal and Run terminal state atomically

GET /stream
  -> atomically snapshot active semantic chunks and register subscriber
  -> replay from start, then forward the same Run's live tail
  -> active Turn but no local hub: 204 active-detached, retry lightweight GET
  -> no unfinished Turn: 204 idle, hydrate PostgreSQL journal once

duplicate POST
  -> local hub exists: subscribe to the same Run
  -> active Turn but no local hub: 409 active_run_detached, then use GET resume
```

浏览器断线不是用户取消。只有显式 Stop、服务端取消或执行故障传播 Run AbortSignal。Runtime 进程在终态提交前消失时，lease/orphan recovery 根据 attempt envelope、journal step 和 effect 事实恢复或解释为 interrupted；stream chunk、HTTP subscriber 和 Redis key 都不是恢复输入。

失败或取消的 assistant message 必须由持久 metadata 明确呈现。前端不能依赖最后一个 error chunk、`finish` 或 `[DONE]` 才显示终态；因此即使连接在终端 chunk 前消失，刷新后仍显示 durable failure，而不是永久“思考中”或无结果。

## 高频工具进度

所有进入 public UIMessage stream 的 preliminary tool result 仍必须是有界快照。特别是 `subagents`：child 的完整 UIMessage 仅在进程内累计，preliminary result 只携带当前 tool states 和有界最新文本；terminal result 才携带完整 message、report、usage 或结构化失败。该规则保护实时 transport、React 渲染和结构化克隆成本，不再被描述为 Redis 容量补丁。

## 被否决方案

| 方案 | 结论 |
| --- | --- |
| 调大 8 MiB 或改成其他固定值 | 否决。改变撞线时间，不修复缓存拥有执行 authority 的错误 |
| Redis 保存完整原始 SSE | 否决。累计 wire log 与 materialized message 大小无关，长 Turn 必然持续增长 |
| Redis `MAXLEN` 裁头后继续 replay | 否决。缺少 `start`、part start 或 tool input 的 tail 不是合法 AI SDK replay |
| 自建 cursor + client merge 协议 | 否决。materialized projection 输出官方完整 replay；客户端继续使用 AI SDK 状态机 |

## 实现与验证

- [run owner](../../apps/backend/services/runtime/src/application/agent/runs/run.ts)：唯一 loop、active hub 注册、completed-step 与 terminal journal；
- [active stream](../../apps/backend/services/runtime/src/application/agent/streams/live.ts)：materialized replay、原子 snapshot/subscription 与 subscriber fan-out；
- [run repository](../../apps/backend/services/runtime/src/application/agent/runs/repository.ts)：Run/attempt/step/message/lease 权威状态；
- [frontend conversation hook](../../apps/frontend/packages/ai-elements/src/Conversation/hooks/useConversationChat.ts)：active-run resume、active-detached 轻量探针、idle journal hydration 与终态同步；
- [message view](../../apps/frontend/packages/ai-elements/src/Conversation/components/ChatMessageView.tsx)：durable failed/cancelled 呈现；
- [transport](../../apps/frontend/packages/ai-elements/src/Conversation/lib/transport.ts)：官方 `DefaultChatTransport` 默认完整 replay；
- [subagents](../../packages/agent-runtime/src/tools/subagents.ts)：有界 preliminary progress。

变更这些边界时运行 `just test backend/runtime`、`just test frontend/@repo/ai-elements`、Runtime build 与全仓 lint。Runtime 测试必须覆盖任意切点下 snapshot+tail 与原始 AI SDK stream 的最终消息等价、慢 subscriber 隔离、delta/tool/metadata projection、completed-step、终态提交、重复请求与 orphan recovery；前端测试必须覆盖完整 replay、active-detached probe、idle journal hydration、duplicate POST 409、失败终态和切换会话后的清理。
