# chat MFE

对话域 micro-frontend，挂载于 `/platform/chat/*`，后端为 chat service。

## 核心约定

- 消息流使用 AI SDK v7 `useChat` + `DefaultChatTransport`，直接消费原生
  UIMessage SSE parts。
- 交互只有 Send/Stop：持久化消息加载后，每个会话调用一次 `resumeStream()`；刷新或
  切换路由可重新订阅 Redis 中的活动 UIMessage SSE。
- Stop 同时调用 `useChat.stop()` 与 run cancel API；前者断开本地 subscriber，后者
  才终止服务端 Agent。浏览器断连本身不再等价于 Stop。
- `ask_user` 等 client tool 通过 `addToolOutput` 回填；所有 client tool 完成后由
  `lastAssistantMessageIsCompleteWithToolCalls` 自动发起下一次 run。
- POST 与恢复 GET 都返回 `x-agent-run-id`，用于 Stop 和执行轨迹查询；stream 内容
  仍完全遵循 AI SDK UIMessage 协议。
- plan 作为 `tool-write_plan` / `tool-update_plan` part 随消息持久化；后续 run 从
  服务端会话历史恢复。
- HTML artifact 使用 sandbox iframe 和独立右侧面板；完整正文按需从 knowledge
  加载，不进入聊天消息。iframe 只有 `allow-scripts`，不授予 same-origin；课件目录
  使用 artifact 内部 `#fragment` 跳转。

普通 CRUD 使用 `api` package；禁止跨 MFE import，跨域通信使用 `runtime` 事件总线。
