# chat MFE

对话域 micro-frontend，挂载于 `/platform/chat/*`，后端为 chat service。

## 核心约定

- 消息流使用 AI SDK v7 `useChat` + `DefaultChatTransport`，直接消费原生
  UIMessage SSE parts。
- 交互只有 Send/Stop：持久化消息加载并确认 `active_run_id` 后才调用 `resumeStream()`；
  空闲会话不做 204 探针，刷新或切换路由可重新订阅 Redis 中的活动 UIMessage SSE。
- Stop 同时调用 `useChat.stop()` 与 run cancel API；前者断开本地 subscriber，后者
  才终止服务端 Agent。浏览器断连本身不再等价于 Stop。
- cancel API 返回后重新读取持久化消息；未完成的 HTML/image/video/tool 卡片使用
  `output-error`，todo 使用 `cancelled`，不得从历史消息继续渲染 loading。
- 会话路由按 conversation id 隔离 `useChat` 实例；切出会话时只 abort 旧实例的
  subscriber，防止多个 running 会话占满浏览器连接池，切回后再从 Redis 回放。
- `ask_user` 等 client tool 通过 `addToolOutput` 回填；所有 client tool 完成后由
  `lastAssistantMessageIsCompleteWithToolCalls` 自动发起下一次 run。一个 `ask_user`
  卡片可展示多个带稳定 ID 的问题，全部回答后只提交一次结构化 tool output。
- client-tool continuation 的 401 先由 `authFetch` 刷新 token 并重放；最终仍失败时保留
  本地 tool output。transport 在进入 AI SDK error 状态前透明地额外重放一次；全部失败
  表示 refresh session 已失效，由全局 session 事件触发路由重新认证，不显示无效的业务
  重试按钮。失败回调不得从持久化历史覆盖尚未写入服务端的回答。
- POST 与恢复 GET 都返回 `x-agent-run-id`，用于 Stop 和执行轨迹查询；stream 内容
  仍完全遵循 AI SDK UIMessage 协议。
- Plan 作为 `tool-save_sandbox_file` 的原生结果随消息持久化，结果携带稳定 Chat `file_id`；
  后续 run 从服务端会话历史和 conversation-file registry 恢复。
- “执行计划”发送严格的持久化 `data-plan-execution { file_id }` 引用；正文不由浏览器复制。
  后端把该不可变 Plan 导入 `/workspace/sources/saved/<file_id>/`，runtime contract 要求先用
  Bash 完整读取。执行结束后按钮变为“再次执行”而不是永久禁用，后续点击仍携带稳定 id，
  不依赖长对话里的旧计划内容。
- `save_sandbox_file` 的官方 tool output 直接携带 file id、文件名与资源元数据，并按
  `uiKind: artifact` 渲染 Artifact 卡；它不会被复制成原生 `file` part。原生 model
  `file`/`reasoning-file` 仍按文件 part 呈现，两类产物保持不同协议语义。
- HTML artifact 使用独立右侧普通 iframe，按浏览器原生语义开放脚本、模块、表单、
  存储、导航、Canvas/WebGL、Worker、媒体和交互能力，不维护 sandbox allow-list。
  完整正文经 Chat 的鉴权 file delivery facade 按需加载，不进入聊天消息。
  Markdown/Plan file id 在同一面板只读渲染。
- 视频工具在进入耐久审批点后返回普通完成态并结束 SSE。右侧导演工作台按
  production id 读取 Executor 投影，展示并结构化编辑分镜，预览/重拍/选择每镜头
  Take，并展示成本、QA、暂存成片和事件；批准或拒绝直接恢复 Workflow Hook，不创建
  新的 Agent run，也不让模型重建执行状态。视频生成请求必须直接调用
  `create_video_production`；模型不得在聊天正文中模拟分镜、预算、Take 或发布审批，也不得让
  用户通过回复文字完成这些审批。

普通 CRUD 使用 `@repo/api`；禁止跨 MFE import，跨域通信使用 `@repo/runtime` 事件总线。
